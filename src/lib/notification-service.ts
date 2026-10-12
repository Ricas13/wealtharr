import "server-only";
import { sql } from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import { getEmailProvider } from "@/lib/email";
import { loadEntitlements } from "@/lib/entitlement-service";
import { DELIVERY_MAX_ATTEMPTS,retryDelaySeconds } from "@/domain/delivery-retry";
import { EXECUTABLE_ACTION_STATUS_SQL,isExecutableActionStatus } from "@/domain/actions";
import { telegramCall } from "@/lib/telegram";
import { calculateAction } from "@/lib/action-service";
import { reminderStillCurrentSql } from "@/lib/review-reminder-sql";

async function refreshActionNotification(notificationId:string,userId:string){
  const owner=await sql.unsafe(
    "SELECT i.id,i.status FROM notifications n JOIN actions a ON a.id=n.action_id "+
    "JOIN strategy_instances i ON i.id=a.strategy_instance_id WHERE n.id=$1 AND n.user_id=$2 AND i.user_id=$2",
    [notificationId,userId]
  );
  if(!owner[0]||owner[0].status!=="ACTIVE")return null;
  // Re-run the existing market, mapping, reconciliation and ledger gates just
  // before delivery. A queued indicative order must not outlive its inputs.
  await calculateAction(String(owner[0].id));
  // notification_action_unique (migration 0003) allows one notification per action, so there is no
  // "newer notification for this action" to compare against here.
  const current=await sql.unsafe(
    "SELECT n.title,n.body FROM notifications n JOIN actions a ON a.id=n.action_id "+
    "JOIN strategy_instances i ON i.id=a.strategy_instance_id JOIN users u ON u.id=n.user_id "+
    "WHERE n.id=$1 AND i.status='ACTIVE' AND u.deleted_at IS NULL "+
    "AND a.status IN ("+EXECUTABLE_ACTION_STATUS_SQL+") "+
    "AND NOT EXISTS (SELECT 1 FROM ledger_events l WHERE l.strategy_instance_id=i.id AND l.created_at>a.calculated_at)",
    [notificationId]
  );
  return current[0]??null;
}

// Is the review announced by a REVIEW_UPCOMING reminder still going to happen on that date?
async function reviewReminderStillCurrent(notificationId:string){
  const rows=await sql.unsafe("SELECT 1 FROM notifications n WHERE n.id=$1 AND "+reminderStillCurrentSql("n"),[notificationId]);
  return Boolean(rows[0]);
}

export async function createDeliveriesForNotification(notificationId: string) {
  const rows=await sql.unsafe("SELECT n.id,n.user_id,n.action_id FROM notifications n WHERE n.id=$1 LIMIT 1",[notificationId]);
  const n=rows[0];if(!n)return;
  const entitlements=await loadEntitlements(String(n.user_id));
  // A plan entitles a channel; delivery also needs somewhere to send it. Queueing Discord for a
  // user who never connected a webhook would only retry to exhaustion and dead-letter.
  const endpoints=await sql.unsafe("SELECT channel FROM notification_endpoints WHERE user_id=$1 AND enabled=true",[n.user_id]);
  const connected=new Set(endpoints.map((row)=>String(row.channel)));
  // The owning account may be deleted after the initial lookup but before queue insertion.
  // Hold a short row lock while creating children and marking the notification handled: this
  // prevents a concurrent account/notification cascade from producing an FK failure and
  // serialises overlapping workers. All inserts and the processed marker commit together.
  await sql.begin(async tx=>{
    const live=await tx.unsafe("SELECT id FROM notifications WHERE id=$1 FOR UPDATE",[notificationId]);
    if(!live[0])return;
    for(const channel of entitlements.notificationChannels){
      if(channel==="IN_APP")continue;
      if((channel==="DISCORD"||channel==="TELEGRAM")&&!connected.has(channel))continue;
      const dedupe=String(notificationId)+":"+channel;
      await tx.unsafe(
        "INSERT INTO notification_deliveries (notification_id,channel,dedupe_key) VALUES ($1,$2,$3) ON CONFLICT (dedupe_key) DO NOTHING",
        [notificationId,channel,dedupe]
      );
    }
    // Even in-app-only notices must be marked handled to avoid an infinite worker backlog.
    await tx.unsafe("UPDATE notifications SET deliveries_created_at=now() WHERE id=$1 AND deliveries_created_at IS NULL",[notificationId]);
  });
}

// A notification whose delivery creation failed is not retried again within this window, so one that
// always fails cannot be picked up repeatedly by the same run (and a batch drains instead of spinning).
const CREATION_RETRY_MINUTES=15;

// Creates deliveries for notifications that have not been through the worker yet. Never-attempted ones
// first (then least recently attempted, then oldest). Each notification is isolated: one that throws is
// stamped and left for a later run, and never prevents the others from being handled. Returns the number
// of notifications attempted.
export async function createPendingDeliveries(limit=200){
  const rows=await sql.unsafe(
    "SELECT id FROM notifications WHERE deliveries_created_at IS NULL "+
    "AND (delivery_attempted_at IS NULL OR delivery_attempted_at<now()-($2::int*interval '1 minute')) "+
    "ORDER BY delivery_attempted_at ASC NULLS FIRST,created_at,id LIMIT $1",
    [limit,CREATION_RETRY_MINUTES]
  );
  for(const row of rows){
    const id=String(row.id);
    try{
      await sql.unsafe("UPDATE notifications SET delivery_attempted_at=now() WHERE id=$1",[id]);
      await createDeliveriesForNotification(id);
    }catch{
      // Stays unprocessed (deliveries_created_at is NULL); retried after the window, behind fresh ones.
    }
  }
  return rows.length;
}

export async function processPendingDeliveries(limit=50){
  return (await processDeliveryBatch(limit,Date.now()+30_000)).sent;
}

// Sends everything that is due, in batches, until nothing is left or the time budget is spent.
export async function processDeliveryBacklog(options:{budgetMs:number;batch?:number}){
  const deadline=Date.now()+options.budgetMs;
  const batch=options.batch??100;
  let sent=0;
  let claimed=0;
  let heldBack=0;
  while(Date.now()<deadline){
    const result=await processDeliveryBatch(batch,deadline);
    sent+=result.sent;
    claimed+=result.claimed;
    heldBack+=result.heldBack;
    if(result.deferred)return {sent,claimed,exhausted:false,heldBack};
    if(result.claimed<batch)return {sent,claimed,exhausted:true,heldBack};
  }
  return {sent,claimed,exhausted:false,heldBack};
}

const CHANNEL_BREAKER_FAILURES=3;

// A claim is a 10-minute lease. A worker that crashed (or lost its connection) between claiming and
// settling leaves the row SENDING; each re-claim consumes an attempt, so once the budget is spent the
// row is dead-lettered rather than retried without limit.
async function deadLetterExhaustedClaims(){
  await sql.unsafe(
    "UPDATE notification_deliveries SET status='DEAD_LETTER',last_error_code='MAX_ATTEMPTS_REACHED',updated_at=now() "+
    "WHERE status IN ('PENDING','SENDING') AND next_attempt_at<=now() AND attempt_count>=$1",
    [DELIVERY_MAX_ATTEMPTS]
  );
}

async function processDeliveryBatch(limit:number,deadline:number){
  await deadLetterExhaustedClaims().catch(()=>{});
  const deliveries=await sql.unsafe(
    "WITH picked AS ("+
    " SELECT id FROM notification_deliveries"+
    " WHERE (status='PENDING' OR (status='SENDING' AND next_attempt_at<=now())) AND next_attempt_at<=now() AND attempt_count<$2"+
    " ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1"+
    "), claimed AS ("+
    " UPDATE notification_deliveries d SET status='SENDING',attempt_count=d.attempt_count+1,next_attempt_at=now()+interval '10 minutes',updated_at=now()"+
    " FROM picked p WHERE d.id=p.id RETURNING d.*"+
    ") SELECT c.id,c.notification_id,c.channel,c.attempt_count,n.title,n.body,n.user_id,n.action_id,n.type,n.strategy_instance_id,n.reminder_due_at,u.email,u.deleted_at AS user_deleted_at,a.status AS action_status,"+
    " CASE WHEN n.action_id IS NULL THEN true ELSE n.id=("+
    "   SELECT newer.id FROM notifications newer WHERE newer.action_id=n.action_id ORDER BY newer.created_at DESC,newer.id DESC LIMIT 1"+
    " ) END AS latest_action_notification"+
    " FROM claimed c JOIN notifications n ON n.id=c.notification_id JOIN users u ON u.id=n.user_id LEFT JOIN actions a ON a.id=n.action_id",
    [limit,DELIVERY_MAX_ATTEMPTS]
  );
  type Claimed=(typeof deliveries)[number];
  let sent=0;
  let heldBack=0;
  const claimed=deliveries.length;
  const entitlementCache=new Map<string,Set<string>>();
  // Revalidation (a full recalculation) is per notification, not per channel: a notification queued on
  // email and Telegram is checked once per batch, and a failure is remembered so the second channel does
  // not repeat it. The outcome, including an error, is replayed to every channel of that notification.
  type Revalidation={ok:true;current:Record<string,unknown>|null}|{ok:false;error:unknown};
  const revalidations=new Map<string,Revalidation>();
  const revalidate=async(notificationId:string,userId:string)=>{
    let entry:Revalidation;
    const cached=revalidations.get(notificationId);
    if(cached)entry=cached;
    else{
      try{entry={ok:true,current:await refreshActionNotification(notificationId,userId)};}
      catch(error){entry={ok:false,error};}
      revalidations.set(notificationId,entry);
    }
    if(!entry.ok)throw entry.error;
    return entry.current;
  };
  // Per-channel circuit breaker. Deliveries are sent one after another, so a provider that is down or
  // timing out (10 s each) would otherwise use the whole time budget on its own queue and starve every
  // other channel behind it. After a few consecutive failures the rest of that channel's batch is put
  // back untouched (no attempt consumed) and retried later, while other channels carry on. Only
  // provider/transport failures count: a failed revalidation is a problem with one user's strategy and
  // says nothing about whether the channel works.
  const consecutiveFailures=new Map<string,number>();
  const tripped=new Set<string>();
  const releaseUnattempted=async(index:number)=>{
    await sql.unsafe(
      "UPDATE notification_deliveries SET status='PENDING',attempt_count=GREATEST(attempt_count-1,0),next_attempt_at=now(),updated_at=now() "+
      "WHERE id=ANY($1::uuid[]) AND status='SENDING'",
      [deliveries.slice(index).map(row=>String(row.id))]
    );
    return {sent,claimed,deferred:deliveries.length-index,heldBack};
  };
  // The attempt was already counted by the claim: retry with backoff while budget remains, else dead-letter.
  const retryOrDeadLetter=async(d:Claimed,failureCode:string,retryAfterSeconds:number|null)=>{
    if(Number(d.attempt_count)>=DELIVERY_MAX_ATTEMPTS){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='DEAD_LETTER',last_error_code='MAX_ATTEMPTS_REACHED',updated_at=now() "+
        "WHERE id=$1 AND status='SENDING'",[d.id]
      );
    }else{
      const delay=retryDelaySeconds(Number(d.attempt_count),String(d.id),retryAfterSeconds);
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='PENDING',next_attempt_at=now()+($2::int*interval '1 second'),"+
        "last_error_code=$3,updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id,delay,failureCode]
      );
    }
  };
  const markSent=async(d:Claimed)=>{
    await sql.unsafe("UPDATE notification_deliveries SET status='SENT',sent_at=now(),updated_at=now(),last_error_code=NULL WHERE id=$1 AND status='SENDING'",[d.id]);
  };
  for(let index=0;index<deliveries.length;index++){
    if(Date.now()>=deadline){
      // No provider call was made for these claims. Return them immediately
      // instead of holding them for ten minutes or consuming their retry budget.
      return releaseUnattempted(index);
    }
    const d=deliveries[index];
    // True once the provider accepted the message. If settling the row then fails, it is retried as SENT
    // rather than sent again.
    let delivered=false;
    // Everything for one delivery is isolated: an unexpected error (database, entitlement lookup, ...)
    // sends only this delivery down the retry/dead-letter path instead of aborting the whole run and
    // leaving every remaining claim SENDING for ten minutes.
    try{
    if(d.user_deleted_at){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='CANCELLED',last_error_code='ACCOUNT_DELETED',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      continue;
    }
    if(d.action_id&&!Boolean(d.latest_action_notification)){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='CANCELLED',last_error_code='SUPERSEDED_ACTION_NOTIFICATION',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      continue;
    }
    if(d.action_id&&!isExecutableActionStatus(String(d.action_status??""))){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='CANCELLED',last_error_code='ACTION_NO_LONGER_ACTIVE',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      continue;
    }
    if(d.action_id==null&&String(d.type)==="REVIEW_UPCOMING"&&!(await reviewReminderStillCurrent(String(d.notification_id)))){
      // An advance reminder has no action to revalidate. It is only sent while its strategy is still
      // active, its review is still scheduled for the announced date, and that date has not arrived
      // (from then on the on-the-day notification is the message).
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='CANCELLED',last_error_code='REMINDER_NO_LONGER_CURRENT',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      continue;
    }
    const userId=String(d.user_id);
    let channels=entitlementCache.get(userId);
    if(!channels){
      channels=(await loadEntitlements(userId)).notificationChannels;
      entitlementCache.set(userId,channels);
    }
    if(!channels.has(String(d.channel))){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='CANCELLED',last_error_code='CHANNEL_NOT_IN_PLAN',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      continue;
    }

    let destination="";
    if(d.channel==="TELEGRAM"||d.channel==="DISCORD"){
      const endpoints=await sql.unsafe("SELECT encrypted_destination FROM notification_endpoints WHERE user_id=$1 AND channel=$2 AND enabled=true LIMIT 1",[d.user_id,d.channel]);
      if(!endpoints[0]){
        // The destination was removed or disabled after this was queued: nothing to retry, and no
        // provider call is needed to know that.
        await sql.unsafe("UPDATE notification_deliveries SET status='CANCELLED',last_error_code='NO_ENDPOINT',updated_at=now() WHERE id=$1 AND status='SENDING'",[d.id]);
        continue;
      }
      destination=String(endpoints[0].encrypted_destination);
    }
    if(tripped.has(String(d.channel))){
      await sql.unsafe(
        "UPDATE notification_deliveries SET status='PENDING',attempt_count=GREATEST(attempt_count-1,0),next_attempt_at=now()+interval '15 minutes',updated_at=now() WHERE id=$1 AND status='SENDING'",
        [d.id]
      );
      heldBack+=1;
      continue;
    }
    let ok=false;
    let retryAfterSeconds:number|null=null;
    let failureCode="DELIVERY_FAILED";
    try{
      if(d.action_id){
        failureCode="ACTION_REVALIDATION_FAILED";
        const current=await revalidate(String(d.notification_id),userId);
        if(!current){
          await sql.unsafe("UPDATE notification_deliveries SET status='CANCELLED',last_error_code='ACTION_NO_LONGER_CURRENT',updated_at=now() WHERE id=$1 AND status='SENDING'",[d.id]);
          continue;
        }
        // Recalculation can revise the notification in place. Never send the
        // title/amount captured when the batch was initially claimed.
        d.title=current.title;
        d.body=current.body;
      }
      if(Date.now()>=deadline)return releaseUnattempted(index);
      failureCode="DELIVERY_FAILED";
      if(d.channel==="EMAIL"){
        ok=await getEmailProvider().send({to:String(d.email),subject:String(d.title),text:String(d.body)});
      }else if(d.channel==="TELEGRAM"){
        const result=await telegramCall("sendMessage",{
          chat_id:decryptSecret(destination),
          text:String(d.title)+"\n"+String(d.body)
        });
        ok=result.ok;
        retryAfterSeconds=result.retryAfterSeconds??null;
      }else if(d.channel==="DISCORD"){
        {
          // allowed_mentions stops message text from ever pinging @everyone/@here or roles.
          const response=await fetch(decryptSecret(destination),{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:"**"+String(d.title)+"**\n"+String(d.body),allowed_mentions:{parse:[]}}),signal:AbortSignal.timeout(10_000),cache:"no-store",redirect:"error"});
          ok=response.ok;
          if(response.status===429){
            const raw=response.headers.get("retry-after");
            if(raw){
              const seconds=Number(raw);
              const date=Date.parse(raw);
              retryAfterSeconds=Number.isFinite(seconds)?seconds:Number.isFinite(date)
                ?Math.ceil((date-Date.now())/1000):null;
            }
          }
        }
      }
    }catch{ok=false;}
    if(ok){
      delivered=true;
      await markSent(d);sent+=1;
      consecutiveFailures.set(String(d.channel),0);
    }else{
      // A failed revalidation (failureCode still ACTION_REVALIDATION_FAILED) is not a channel failure.
      if(failureCode==="DELIVERY_FAILED"){
        const failures=(consecutiveFailures.get(String(d.channel))??0)+1;
        consecutiveFailures.set(String(d.channel),failures);
        if(failures>=CHANNEL_BREAKER_FAILURES)tripped.add(String(d.channel));
      }
      await retryOrDeadLetter(d,failureCode,retryAfterSeconds);
    }
    }catch{
      try{
        if(delivered)await markSent(d);
        else await retryOrDeadLetter(d,"DELIVERY_FAILED",null);
      }catch{
        // The database itself is failing. The claim lease expires on its own and the attempt it consumed
        // is what eventually dead-letters a row that can never be settled.
      }
    }
  }
  return {sent,claimed,deferred:0,heldBack};
}
