import { afterAll,beforeAll,describe,expect,it,vi } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";

// Cross-tenant matrix. Every strategy- and action-scoped route is called as a second user against
// the first user's resources. Handlers, validation, queries and the database are real; only the
// session lookup is replaced so the caller can be chosen.
type SessionUser={id:string;email:string;country:string;baseCurrency:string;timezone:string;role:string;anonymousAggregateOptIn:boolean};
const session=vi.hoisted(()=>({user:null as SessionUser|null}));
vi.mock("@/lib/session",()=>({
  requireUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;},
  requireAdmin:async()=>{
    if(!session.user)throw new Error("UNAUTHENTICATED");
    if(session.user.role!=="ADMIN")throw new Error("FORBIDDEN");
    return session.user;
  },
  requirePageUser:async()=>{if(!session.user)throw new Error("UNAUTHENTICATED");return session.user;}
}));

const url=process.env.DATABASE_URL;
const sql=url?postgres(url,{max:3,prepare:false}):null;
const ORIGIN="http://127.0.0.1:3000";

type Tenant={user:SessionUser;accountId:string;instanceId:string;eventId:string;actionId:string};
type Handler=(request:Request,context:{params:Promise<Record<string,string>>})=>Promise<Response>;
type Case={
  name:string;
  load:()=>Promise<Record<string,unknown>>;
  method:"GET"|"POST"|"PATCH"|"DELETE";
  params:(t:Tenant,eventOwner:Tenant)=>Record<string,string>;
  body?:(accountOwner:Tenant)=>unknown;
  // Case whose own-account control is expected to fail for domain reasons rather than succeed.
  domainOnly?:boolean;
};

const ids={
  fieldKey:"strategy_state.targetValue"
};
const cases:Case[]=[
  {name:"accounts GET",load:()=>import("@/app/api/strategies/[id]/accounts/route"),method:"GET",params:(t)=>({id:t.instanceId})},
  {name:"accounts POST",load:()=>import("@/app/api/strategies/[id]/accounts/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({name:"Extra",wrapper:"ISA",currency:"GBP"})},
  {name:"calculate",load:()=>import("@/app/api/strategies/[id]/calculate/route"),method:"POST",params:(t)=>({id:t.instanceId})},
  {name:"contribution-plan",load:()=>import("@/app/api/strategies/[id]/contribution-plan/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({enabled:true,amount:"100",frequency:"MONTHLY",nextDate:"2030-01-01"})},
  {name:"contributions",load:()=>import("@/app/api/strategies/[id]/contributions/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({amount:"50",accountId:o.accountId,requestKey:randomUUID()})},
  {name:"execution-constraints",load:()=>import("@/app/api/strategies/[id]/execution-constraints/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({fractionalShares:false,minimumTradeAmount:"5",cashBufferAmount:"1",flatFee:"1",allowSelling:false})},
  {name:"ledger-events",load:()=>import("@/app/api/strategies/[id]/ledger-events/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({eventType:"INTEREST",amount:"5",accountId:o.accountId,requestKey:randomUUID()})},
  {name:"ledger-events correct",load:()=>import("@/app/api/strategies/[id]/ledger-events/[eventId]/correct/route"),method:"POST",params:(t,e)=>({id:t.instanceId,eventId:e.eventId}),body:()=>({reason:"tenancy matrix"})},
  {name:"splits",load:()=>import("@/app/api/strategies/[id]/splits/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({instrumentId:randomUUID(),ratio:"2",accountId:o.accountId,requestKey:randomUUID()}),domainOnly:true},
  {name:"opening-snapshot",load:()=>import("@/app/api/strategies/[id]/opening-snapshot/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({accountId:o.accountId,cash:"10"}),domainOnly:true},
  {name:"overrides POST",load:()=>import("@/app/api/strategies/[id]/overrides/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({fieldKey:ids.fieldKey,manualValue:"1234",reason:"tenancy matrix run",confirmed:true})},
  {name:"overrides DELETE",load:()=>import("@/app/api/strategies/[id]/overrides/route"),method:"DELETE",params:(t)=>({id:t.instanceId}),body:()=>({fieldKey:ids.fieldKey})},
  {name:"preview",load:()=>import("@/app/api/strategies/[id]/preview/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({type:"CONTRIBUTION",amount:"100"})},
  {name:"reconcile",load:()=>import("@/app/api/strategies/[id]/reconcile/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({expectedValue:"100",brokerValue:"90",affectsCash:true,accountId:o.accountId,requestKey:randomUUID()})},
  {name:"status",load:()=>import("@/app/api/strategies/[id]/status/route"),method:"PATCH",params:(t)=>({id:t.instanceId}),body:()=>({status:"CLOSED"})},
  {name:"switch",load:()=>import("@/app/api/strategies/[id]/switch/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({targetStrategyKey:"hfea"}),domainOnly:true},
  {name:"trades",load:()=>import("@/app/api/strategies/[id]/trades/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:(o)=>({accountId:o.accountId,ticker:"TQQQ",exchange:"NASDAQ",executedAt:"2026-01-02T15:00:00Z",side:"BUY",quantity:"1",unitPrice:"10",requestKey:randomUUID(),brokerFillConfirmed:true}),domainOnly:true},
  {name:"version POST",load:()=>import("@/app/api/strategies/[id]/version/route"),method:"POST",params:(t)=>({id:t.instanceId}),body:()=>({targetVersionId:randomUUID()}),domainOnly:true},
  {name:"version PATCH",load:()=>import("@/app/api/strategies/[id]/version/route"),method:"PATCH",params:(t)=>({id:t.instanceId}),body:()=>({targetVersionId:randomUUID()}),domainOnly:true},
  {name:"action execute",load:()=>import("@/app/api/actions/[id]/execute/route"),method:"POST",params:(t)=>({id:t.actionId}),body:()=>({}),domainOnly:true}
];

async function call(testCase:Case,caller:SessionUser,params:Record<string,string>,body:unknown){
  session.user=caller;
  const handler=(await testCase.load())[testCase.method] as Handler;
  const request=new Request(ORIGIN+"/api/test",{
    method:testCase.method,
    headers:{origin:ORIGIN,"content-type":"application/json"},
    body:body===undefined||testCase.method==="GET"?undefined:JSON.stringify(body)
  });
  const response=await handler(request,{params:Promise.resolve(params)});
  return {status:response.status,text:await response.text()};
}

async function fingerprint(t:Tenant){
  const rows=await sql!.unsafe(
    "SELECT md5(concat_ws('|',"+
    "(SELECT coalesce(string_agg(concat_ws(',',id,status,strategy_version_id,settings::text,execution_constraints::text,contribution_plan::text,name),';' ORDER BY id),'') FROM strategy_instances WHERE user_id=$1),"+
    "(SELECT count(*)::text FROM accounts WHERE user_id=$1),"+
    "(SELECT count(*)::text FROM ledger_events WHERE strategy_instance_id=$2),"+
    "(SELECT coalesce(string_agg(concat_ws(',',id,status),';' ORDER BY id),'') FROM actions WHERE strategy_instance_id=$2),"+
    "(SELECT count(*)::text FROM reconciliations WHERE strategy_instance_id=$2),"+
    "(SELECT count(*)::text FROM overrides WHERE strategy_instance_id=$2),"+
    "(SELECT coalesce(string_agg(state::text,';'),'') FROM strategy_states WHERE strategy_instance_id=$2),"+
    "(SELECT count(*)::text FROM strategy_accounts WHERE strategy_instance_id=$2),"+
    "(SELECT count(*)::text FROM audit_events WHERE entity_id=$2::text OR metadata->>'strategyInstanceId'=$2::text)"+
    ")) AS h",
    [t.user.id,t.instanceId]
  );
  return String(rows[0].h);
}

describe.skipIf(!url)("cross-tenant isolation matrix",()=>{
  const run=Math.random().toString(36).slice(2,10);
  const created:string[]=[];
  let owner:Tenant;
  const controlStatuses:Array<{route:string;status:number}> = [];

  async function tenant(label:string,role="USER"):Promise<Tenant>{
    const users=await sql!.unsafe("INSERT INTO users (email,password_hash,role) VALUES ($1,'x',$2) RETURNING id",[`tm-${label}-${run}-${created.length}@example.test`,role]);
    const userId=String(users[0].id);
    created.push(userId);
    const pro=await sql!.unsafe("SELECT id FROM plans WHERE slug='pro'");
    await sql!.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'ACTIVE','MONTHLY')",[userId,pro[0].id]);
    const account=await sql!.unsafe("INSERT INTO accounts (user_id,name,wrapper,country,currency) VALUES ($1,'Matrix','ISA','GB','GBP') RETURNING id",[userId]);
    const instance=await sql!.unsafe(
      "INSERT INTO strategy_instances (user_id,account_id,strategy_definition_id,strategy_version_id,name) "+
      "SELECT $1,$2,d.id,v.id,'Matrix' FROM strategy_definitions d JOIN strategy_versions v ON v.strategy_definition_id=d.id WHERE d.key='9sig' AND v.lifecycle_status='PUBLISHED' LIMIT 1 RETURNING id,strategy_version_id",
      [userId,account[0].id]
    );
    const instanceId=String(instance[0].id);
    await sql!.unsafe("INSERT INTO strategy_accounts (strategy_instance_id,account_id,role) VALUES ($1,$2,'PRIMARY')",[instanceId,account[0].id]);
    await sql!.unsafe("INSERT INTO strategy_states (strategy_instance_id,strategy_version_id,state) VALUES ($1,$2,'{\"forceReview\":true}'::jsonb)",[instanceId,instance[0].strategy_version_id]);
    const event=await sql!.unsafe("INSERT INTO ledger_events (strategy_instance_id,account_id,occurred_at,event_type,currency,cash_amount) VALUES ($1,$2,now(),'CONTRIBUTION','GBP',1000) RETURNING id",[instanceId,account[0].id]);
    const action=await sql!.unsafe(
      "INSERT INTO actions (strategy_instance_id,account_id,strategy_version_id,fingerprint,action_type,status,title,instruction) VALUES ($1,$2,$3,$4,'HOLD','CALCULATED','Hold','Hold') RETURNING id",
      [instanceId,account[0].id,instance[0].strategy_version_id,"matrix-"+randomUUID()]
    );
    return {
      user:{id:userId,email:`tm-${label}-${run}@example.test`,country:"GB",baseCurrency:"GBP",timezone:"Europe/London",role,anonymousAggregateOptIn:true},
      accountId:String(account[0].id),instanceId,eventId:String(event[0].id),actionId:String(action[0].id)
    };
  }

  beforeAll(async()=>{
    process.env.NEXT_PUBLIC_APP_URL=ORIGIN;
    owner=await tenant("owner");
  });

  afterAll(async()=>{
    if(!sql)return;
    console.log("CONTROL_STATUSES",JSON.stringify(controlStatuses));
    await sql.unsafe("DELETE FROM users WHERE id=ANY($1::uuid[])",[created]);
    await sql.unsafe("DELETE FROM rate_limits WHERE key LIKE ANY($1)",[created.map((id)=>"%"+id)]);
    await sql.end();
  });

  for(const testCase of cases){
    describe(testCase.name,()=>{
      it("a different user cannot read or change another user's resource",async()=>{
        const attacker=await tenant("attacker");
        const before=await fingerprint(owner);
        const result=await call(testCase,attacker.user,testCase.params(owner,owner),testCase.body?.(owner));
        if(testCase.name==="accounts GET"){
          // Lists are scoped by owner: an empty list (200) is acceptable as long as nothing leaks.
          expect(result.text).not.toContain(owner.accountId);
        }else{
          expect(result.status,result.text).toBeGreaterThanOrEqual(400);
          expect(result.status,result.text).toBeLessThan(500);
        }
        expect(await fingerprint(owner)).toBe(before);
        expect(result.text).not.toContain(owner.instanceId);
      });

      it("a user cannot attach another user's account or ledger event to their own strategy",async()=>{
        const attacker=await tenant("cross");
        const before=await fingerprint(owner);
        const result=await call(testCase,attacker.user,testCase.params(attacker,owner),testCase.body?.(owner));
        const foreignRows=await sql!.unsafe(
          "SELECT (SELECT count(*) FROM ledger_events WHERE strategy_instance_id=$1 AND account_id=$2)::int AS ledger,"+
          "(SELECT count(*) FROM reconciliations WHERE strategy_instance_id=$1 AND account_id=$2)::int AS recon,"+
          "(SELECT count(*) FROM strategy_accounts WHERE strategy_instance_id=$1 AND account_id=$2)::int AS linked",
          [attacker.instanceId,owner.accountId]
        );
        expect(foreignRows[0],`status ${result.status}: ${result.text}`).toMatchObject({ledger:0,recon:0,linked:0});
        expect(await fingerprint(owner)).toBe(before);
      });

      it("works for the rightful owner (control: the payload and route are valid)",async()=>{
        const mine=await tenant("control");
        const result=await call(testCase,mine.user,testCase.params(mine,mine),testCase.body?.(mine));
        controlStatuses.push({route:testCase.name,status:result.status});
        expect([401,403,404],`${result.status}: ${result.text}`).not.toContain(result.status);
        expect(result.status,result.text).toBeLessThan(500);
        if(!testCase.domainOnly)expect(result.status,result.text).toBeLessThan(300);
      });
    });
  }
});
