import type Decimal from "decimal.js";
import {LedgerDecimal} from "@/domain/ledger-decimal";
import {z} from "zod";
import {requireUser} from "@/lib/session";
import {assertSameOrigin,consumeRateLimit} from "@/lib/security";
import {getStrategyForUser} from "@/lib/strategy-service";
import {recalculateAfterMutation} from "@/lib/action-service";
import {exchangeTradingDate,historicalBrokerFill} from "@/domain/historical-trade";
import {sql} from "@/lib/db";
import { authFailure } from "@/lib/api-auth";

const decimal=z.string().regex(/^\d+(?:\.\d{1,12})?$/);
const inputSchema=z.object({
  accountId:z.string().uuid(),
  ticker:z.string().regex(/^[A-Za-z0-9.^_-]{1,24}$/),
  exchange:z.string().regex(/^[A-Za-z0-9._-]{1,24}$/),
  executedAt:z.string().datetime({offset:true}),
  side:z.enum(["BUY","SELL"]),
  quantity:decimal,
  unitPrice:decimal,
  fee:decimal.default("0"),
  requestKey:z.string().uuid(),
  brokerFillConfirmed:z.literal(true),
  note:z.string().max(240).optional()
}).strict();

/**
 * Import the *actual* broker fill. Indicative historical provider quotes must
 * never silently become executed prices. The ledger is append-only.
 */
export async function POST(request:Request,context:{params:Promise<{id:string}>}){
  try{
    assertSameOrigin(request);
    const user=await requireUser();
    await consumeRateLimit("broker-trade:"+user.id,20,60);
    const {id}=await context.params;
    const strategy=await getStrategyForUser(user.id,id);
    if(!strategy)return Response.json({error:"Strategy not found."},{status:404});
    const input=inputSchema.parse(await request.json());
    const executedAt=new Date(input.executedAt);
    const tradingDate=exchangeTradingDate(executedAt,input.exchange);
    const fill=historicalBrokerFill({
      side:input.side,quantity:input.quantity,unitPrice:input.unitPrice,fee:input.fee,
      executedAt,currency:String(strategy.currency).toUpperCase()
    });
    const identity=JSON.stringify({
      accountId:input.accountId,ticker:input.ticker.toUpperCase(),exchange:input.exchange.toUpperCase(),
      executedAt:executedAt.toISOString(),side:input.side,quantity:fill.quantity.abs().toString(),
      unitPrice:new LedgerDecimal(input.unitPrice).toString(),fee:fill.feeAmount.toString()
    });
    const result=await sql.begin(async(tx)=>{
      const rows=await tx.unsafe(
        "SELECT i.id,i.status,i.account_id AS primary_account_id,i.onboarding_mode,sa.account_id,a.currency,"+
        "v.engine_key,v.config,ss.state FROM strategy_instances i "+
        "JOIN strategy_accounts sa ON sa.strategy_instance_id=i.id "+
        "JOIN accounts a ON a.id=sa.account_id JOIN strategy_versions v ON v.id=i.strategy_version_id "+
        "JOIN strategy_states ss ON ss.strategy_instance_id=i.id "+
        "WHERE i.id=$1 AND i.user_id=$2 AND sa.account_id=$3 FOR UPDATE OF i",
        [id,user.id,input.accountId]
      );
      const instance=rows[0];
      if(!instance)throw new Error("ACCOUNT_NOT_LINKED");
      // A committed fill remains recoverable after a review or lifecycle change.
      // Ownership/account checks still precede replay; no new write occurs here.
      const previous=await tx.unsafe(
        "SELECT id,metadata FROM ledger_events WHERE strategy_instance_id=$1 AND request_key=$2 LIMIT 1",
        [id,input.requestKey]
      );
      if(previous[0]){
        const metadata=previous[0].metadata as Record<string,unknown>|null;
        if(metadata?.brokerFillIdentity!==identity)throw new Error("TRADE_REQUEST_KEY_CONFLICT");
        return {id:String(previous[0].id),status:String(instance.status),duplicate:true};
      }
      if(String(instance.status)==="CLOSED")throw new Error("STRATEGY_CLOSED");
      if(!["ACTIVE","PAUSED"].includes(String(instance.status)))throw new Error("STRATEGY_NOT_ACTIVE");
      if(String(instance.currency).toUpperCase()!==fill.currency)throw new Error("TRADE_CURRENCY_MISMATCH");
      const state=(instance.state??{}) as Record<string,unknown>;
      if(state.resumeNeedsReconciliation||state.unresolvedReconciliation)throw new Error("TRADE_RECONCILIATION_REQUIRED");
      if(state.lastReviewAt&&executedAt<new Date(String(state.lastReviewAt)))
        throw new Error("TRADE_BEFORE_LAST_REVIEW");

      const matches=await tx.unsafe(
        "SELECT tl.id,tl.instrument_id,i.economic_exposure FROM trading_lines tl "+
        "JOIN instruments i ON i.id=tl.instrument_id "+
        "WHERE upper(tl.ticker)=upper($1) AND upper(tl.exchange)=upper($2) "+
        "AND upper(tl.currency)=upper($3) AND tl.effective_from<=$4::date "+
        "AND (tl.effective_to IS NULL OR tl.effective_to>=$4::date) LIMIT 2",
        [input.ticker,input.exchange,instance.currency,tradingDate]
      );
      if(matches.length!==1)throw new Error("TRADE_TRADING_LINE_AMBIGUOUS_OR_MISSING");
      const line=matches[0];
      const config=(instance.config??{}) as Record<string,unknown>;
      const engine=String(instance.engine_key);
      const exposure=String(line.economic_exposure);
      if(engine==="VALUE_TARGET"&&exposure!==String(config.targetExposure))
        throw new Error("TRADE_EXPOSURE_NOT_MANAGED");
      if(engine==="FIXED_ALLOCATION"&&!(Array.isArray(config.allocations)&&
        config.allocations.some((a:unknown)=>!!a&&typeof a==="object"&&
          String((a as Record<string,unknown>).exposure)===exposure)))
        throw new Error("TRADE_EXPOSURE_NOT_MANAGED");
      if(!["VALUE_TARGET","FIXED_ALLOCATION"].includes(engine))
        throw new Error("TRADE_ENGINE_NOT_VERIFIED");

      // Validate every intermediate balance *after inserting the historical
      // event*, including later events: a backdated fill cannot manufacture
      // cash or leave a later period with negative holdings.
      const history=await tx.unsafe(
        "SELECT occurred_at,cash_amount,fee_amount,instrument_id,quantity FROM ledger_events "+
        "WHERE strategy_instance_id=$1 AND (account_id=$2 OR (account_id IS NULL AND $2=$3)) "+
        "ORDER BY occurred_at,created_at,id",
        [id,input.accountId,instance.primary_account_id]
      );
      const timeline=history.map(r=>({
        at:new Date(r.occurred_at).getTime(),cash:new LedgerDecimal(String(r.cash_amount)),
        fee:new LedgerDecimal(String(r.fee_amount)),instrument:r.instrument_id?String(r.instrument_id):"",
        quantity:new LedgerDecimal(String(r.quantity))
      }));
      timeline.push({
        at:executedAt.getTime(),cash:fill.cashAmount,fee:fill.feeAmount,
        instrument:String(line.instrument_id),quantity:fill.quantity
      });
      timeline.sort((a,b)=>a.at-b.at);
      let cash=new LedgerDecimal(0);
      const quantities=new Map<string,Decimal>();
      for(const entry of timeline){
        cash=cash.plus(entry.cash).minus(entry.fee);
        if(cash.lt(0))throw new Error("TRADE_INSUFFICIENT_HISTORICAL_CASH");
        if(entry.instrument){
          const units=(quantities.get(entry.instrument)??new LedgerDecimal(0)).plus(entry.quantity);
          if(units.lt(0))throw new Error("TRADE_INSUFFICIENT_HISTORICAL_HOLDINGS");
          quantities.set(entry.instrument,units);
        }
      }

      const inserted=await tx.unsafe(
        "INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount,"+
        "instrument_id,quantity,unit_price,fee_amount,provenance,confidence,metadata,request_key,created_by) "+
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'USER_CONFIRMED','VERIFIED',$11::jsonb,$12,'USER') RETURNING id",
        [id,input.accountId,executedAt,input.side,fill.currency,fill.cashAmount.toString(),
         line.instrument_id,fill.quantity.toString(),new LedgerDecimal(input.unitPrice).toString(),fill.feeAmount.toString(),
         JSON.stringify({brokerFillIdentity:identity,tradingLineId:String(line.id),ticker:input.ticker.toUpperCase(),
           exchange:input.exchange.toUpperCase(),exchangeTradingDate:tradingDate,
           source:"USER_CONFIRMED_BROKER_FILL",note:input.note??null,
           notice:"Historical market quote is not a broker fill; no provider price has been substituted."}),input.requestKey]
      );
      const eventId=String(inserted[0].id);
      if(String(instance.onboarding_mode)==="START_NEW"&&!state.lastReviewAt){
        // Importing a fill does not confirm the whole initial allocation. Keep
        // calculating outstanding legs until the user confirms the final HOLD.
        await tx.unsafe(
          "UPDATE strategy_states SET state=state || '{\"forceReview\":true}'::jsonb,calculated_at=now() WHERE strategy_instance_id=$1",
          [id]
        );
      }
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) "+
        "VALUES ($1,'ledger.broker-fill-imported','ledger_event',$2,$3::jsonb)",
        [user.id,eventId,JSON.stringify({strategyInstanceId:id,accountId:input.accountId,
          eventType:input.side,executedAt:executedAt.toISOString(),tradingLineId:String(line.id),
          requestKey:input.requestKey})]
      );
      return {id:eventId,status:String(instance.status),duplicate:false};
    });
    const recalculation=result.status==="ACTIVE"&&!result.duplicate
      ?await recalculateAfterMutation(id,user.id,"broker-trade")
      :{actionId:null,recalculationPending:false,errorCode:null};
    return Response.json({ok:true,eventId:result.id,duplicate:result.duplicate,
      actionId:recalculation.actionId,recalculationPending:recalculation.recalculationPending},
      {headers:{"cache-control":"private, no-store"}});
  }catch(error){const denied=authFailure(error);if(denied)return denied;
    if(error instanceof z.ZodError)return Response.json({error:"Confirm account, exact broker fill, fee, and ISO execution time with offset."},{status:400});
    const code=error instanceof Error?error.message:"FAILED";
    if(code==="RATE_LIMITED")return Response.json({error:"Too many requests."},{status:429});
    const messages:Record<string,string>={
      INVALID_TRADE_TIMESTAMP:"Choose a valid past trade time, including its timezone offset.",
      UNSUPPORTED_EXCHANGE_TIMEZONE:"This exchange needs a verified timezone mapping before import.",
      TRADE_CURRENCY_MISMATCH:"Broker fill currency does not match this account. FX conversions must be recorded separately.",
      TRADE_BEFORE_LAST_REVIEW:"This trade predates a completed review. Reconcile the strategy before importing it.",
      TRADE_EXPOSURE_NOT_MANAGED:"This instrument is outside the exposure managed by this strategy.",
      TRADE_ENGINE_NOT_VERIFIED:"Historical trade import is not yet validated for this strategy engine.",
      TRADE_TRADING_LINE_AMBIGUOUS_OR_MISSING:"No unique instrument line matched this exchange, currency and trading date.",
      TRADE_REQUEST_KEY_CONFLICT:"The retry key was already used for a different trade.",
      TRADE_INSUFFICIENT_HISTORICAL_CASH:"Record the funding contribution before this trade; cash would be negative on a historical date.",
      TRADE_INSUFFICIENT_HISTORICAL_HOLDINGS:"The historical trade sequence would sell more units than were held.",
      TRADE_RECONCILIATION_REQUIRED:"Finish the opening holdings reconciliation before importing trades.",
      STRATEGY_CLOSED:"Closed strategies are read-only.",
      ACCOUNT_NOT_LINKED:"Account not linked to this strategy."
    };
    return Response.json({error:messages[code]??"Could not record broker trade."},
      {status:code==="ACCOUNT_NOT_LINKED"?404:code==="FAILED"?500:409});
  }
}
