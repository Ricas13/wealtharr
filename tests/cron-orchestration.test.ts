import { beforeEach,describe,expect,it,vi } from "vitest";

// The worker's orchestration (lease, ordering, budget, deferral, health) with every collaborator
// faked, so it is deterministic and cannot touch other tenants' data in a shared test database.
const h=vi.hoisted(()=>({
  leaseHeld:false,
  settingsBootstraps:0,
  instances:[] as string[],
  totalActive:0,
  owners:[] as string[],
  aggregatesRecent:false,
  calculated:[] as string[],
  calcDelayMs:0,
  queries:[] as string[],
  finishedLease:null as null|{status:string},
  market:{provider:"mock",configured:true,refreshed:0,failed:0,skipped:0},
  deletions:{completed:0,stalled:0},
  pendingDeliveries:0,
  backlog:{sent:0,claimed:0,exhausted:true},
  aggregatesRan:0,
  billing:{configured:true,checked:0,failed:0,deferred:0,hasMore:false} as Record<string,unknown>,
  // Names the collaborator that should throw ("marketData","billing","deliveries","aggregates","retention","deletions").
  throwIn:null as string|null,
  retention:{deleted:{},failed:{},deferred:0} as Record<string,unknown>,
  retentionCalls:[] as Array<Record<string,unknown>>
}));

vi.mock("@/lib/db",()=>{
  const route=(query:string,params:unknown[]=[])=>{
    h.queries.push(query);
    if(query.includes("UPDATE worker_runs")){h.finishedLease={status:String(params[0])};return [];}
    if(query.includes("anonymous-aggregates"))return h.aggregatesRecent?[{}]:[];
    if(query.includes("u.entitlement_checked_at ASC NULLS FIRST"))return h.owners.map((id)=>({user_id:id}));
    if(query.includes("count(*)::int AS n"))return [{n:h.totalActive}];
    if(query.includes("ORDER BY i.last_calculation_attempt_at ASC")){
      const limit=Number(params[0]);
      return h.instances.slice(0,limit).map((id)=>({id}));
    }
    return [];
  };
  const tx={unsafe:async(query:string)=>{
    if(query.includes("worker_key='cron-actions' AND status='RUNNING'"))return h.leaseHeld?[{}]:[];
    if(query.includes("INSERT INTO worker_runs"))return [{id:"lease-1"}];
    return [];
  }};
  return {sql:{unsafe:async(query:string,params?:unknown[])=>route(query,params),begin:async(fn:(t:typeof tx)=>unknown)=>fn(tx)}};
});
vi.mock("@/lib/settings",()=>({ensureSettings:async()=>{h.settingsBootstraps+=1;}}));
vi.mock("@/lib/action-service",()=>({calculateAction:async(id:string)=>{
  if(h.calcDelayMs)await new Promise((resolve)=>setTimeout(resolve,h.calcDelayMs));
  if(id==="boom")throw new Error("calc failed");
  h.calculated.push(id);
}}));
vi.mock("@/lib/notification-service",()=>({
  createPendingDeliveries:async()=>h.pendingDeliveries,
  processDeliveryBacklog:async()=>{if(h.throwIn==="deliveries")throw new Error("MAIL_PROVIDER_DOWN");return h.backlog;}
}));
vi.mock("@/lib/aggregate-service",()=>({rebuildAnonymousAggregates:async()=>{
  if(h.throwIn==="aggregates")throw new Error("AGGREGATES_BROKEN");
  h.aggregatesRan+=1;return {written:1};
}}));
vi.mock("@/lib/market-data-worker",()=>({refreshMarketData:async()=>{if(h.throwIn==="marketData")throw new Error("MARKET_PROVIDER_DOWN");return h.market;}}));
vi.mock("@/lib/entitlement-service",()=>({enforceStrategyEntitlements:async()=>({paused:0})}));
vi.mock("@/lib/account-deletion",()=>({finishPendingAccountDeletions:async()=>{if(h.throwIn==="deletions")throw new Error("DELETION_BROKEN");return h.deletions;}}));
vi.mock("@/lib/billing-reconciliation",()=>({reconcileStripeSubscriptions:async()=>{if(h.throwIn==="billing")throw new Error("STRIPE_DOWN");return h.billing;}}));
vi.mock("@/lib/retention",()=>({runRetention:async(options:Record<string,unknown>)=>{
  h.retentionCalls.push(options);
  if(h.throwIn==="retention")throw new Error("RETENTION_BROKEN");
  return h.retention;
}}));
vi.mock("@/lib/review-reminder",()=>({createReviewReminders:async()=>({enabled:false,considered:0,created:0,deferred:false})}));

const call=async(authorization?:string)=>{
  const {GET}=await import("@/app/api/cron/actions/route");
  const response=await GET(new Request("http://localhost/api/cron/actions",{headers:authorization?{authorization}:{}}));
  const text=await response.text();
  let json:Record<string,any>={};
  try{json=JSON.parse(text);}catch{json={body:text};}
  return {status:response.status,json};
};
const ok="Bearer cron-secret";

describe("hourly worker orchestration",()=>{
  beforeEach(()=>{
    process.env.CRON_SECRET="cron-secret";
    process.env.MARKET_DATA_MODE="MANUAL";
    delete process.env.CRON_TIME_BUDGET_MS;delete process.env.CRON_MAX_INSTANCES;delete process.env.CRON_CONCURRENCY;
    Object.assign(h,{leaseHeld:false,settingsBootstraps:0,instances:[],totalActive:0,owners:[],aggregatesRecent:false,calculated:[],calcDelayMs:0,queries:[],finishedLease:null,
      market:{provider:"mock",configured:true,refreshed:0,failed:0,skipped:0},deletions:{completed:0,stalled:0},pendingDeliveries:0,
      backlog:{sent:0,claimed:0,exhausted:true},aggregatesRan:0,
      billing:{configured:true,checked:0,failed:0,deferred:0,hasMore:false},
      throwIn:null,retention:{deleted:{},failed:{},deferred:0},retentionCalls:[]});
    delete process.env.VERCEL;
  });

  it("refuses calls without the bearer secret and does no work",async()=>{
    expect((await call()).status).toBe(401);
    expect((await call("Bearer nope")).status).toBe(401);
    expect(h.settingsBootstraps).toBe(0);
    expect(h.queries).toHaveLength(0);
  });

  it("skips a run that would overlap one already in progress",async()=>{
    h.leaseHeld=true;h.instances=["a","b"];h.totalActive=2;
    const result=await call(ok);
    expect(result).toMatchObject({status:202,json:{ok:true,status:"skipped",reason:"ALREADY_RUNNING"}});
    expect(h.calculated).toEqual([]);
    expect(h.settingsBootstraps).toBe(1);
  });

  it("calculates every active strategy and reports healthy",async()=>{
    h.instances=["a","b","c"];h.totalActive=3;
    const result=await call(ok);
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ok:true,status:"healthy",calculated:3,calculationFailures:0,deferred:{calculations:0}});
    expect([...h.calculated].sort()).toEqual(["a","b","c"]);
    expect(h.finishedLease?.status).toBe("SUCCESS");
  });

  it("picks the least recently attempted strategies first when capped, and reports the rest as deferred",async()=>{
    // The query is ordered least-recently-attempted first; the fake returns them in that order.
    h.instances=["stalest","stale","fresh","fresher","freshest"];h.totalActive=5;
    process.env.CRON_MAX_INSTANCES="2";process.env.CRON_CONCURRENCY="1";
    const result=await call(ok);
    expect(h.calculated).toEqual(["stalest","stale"]);
    expect(result.status).toBe(503);
    expect(result.json).toMatchObject({ok:false,status:"degraded",calculated:2,deferred:{calculations:3}});
    expect(h.queries.find((q)=>q.includes("ORDER BY i.last_calculation_attempt_at ASC"))).toContain("LIMIT $1");
  });

  it("stops starting work when the time budget runs out instead of overrunning",async()=>{
    h.instances=Array.from({length:30},(_,i)=>"s"+i);h.totalActive=30;h.calcDelayMs=25;
    process.env.CRON_TIME_BUDGET_MS="200";process.env.CRON_CONCURRENCY="2";
    const result=await call(ok);
    expect(h.calculated.length).toBeGreaterThan(0);
    expect(h.calculated.length).toBeLessThan(30);
    expect(result.json.deferred.calculations).toBe(30-h.calculated.length);
    expect(result.json.ok).toBe(false);
  });

  it("counts failures without letting one break the run",async()=>{
    h.instances=["a","boom","c"];h.totalActive=3;
    const result=await call(ok);
    expect(result.json).toMatchObject({calculated:2,calculationFailures:1,ok:false});
    expect([...h.calculated].sort()).toEqual(["a","c"]);
  });

  it("is degraded when deliveries are still backlogged, a deletion stalled or quote refresh was skipped",async()=>{
    h.instances=["a"];h.totalActive=1;
    h.backlog={sent:100,claimed:100,exhausted:false};
    expect((await call(ok)).json).toMatchObject({ok:false,deferred:{deliveriesBacklog:true}});
    h.backlog={sent:0,claimed:0,exhausted:true};h.deletions={completed:0,stalled:2};
    expect((await call(ok)).json.ok).toBe(false);
    h.deletions={completed:0,stalled:0};
    process.env.MARKET_DATA_MODE="PROVIDER";h.market={provider:"http",configured:true,refreshed:3,failed:0,skipped:4};
    expect((await call(ok)).json.ok).toBe(false);
  });

  it("only rebuilds the daily aggregates when they are due",async()=>{
    h.aggregatesRecent=true;
    await call(ok);
    expect(h.aggregatesRan).toBe(0);
    h.aggregatesRecent=false;
    await call(ok);
    expect(h.aggregatesRan).toBe(1);
  });

  it("reports missed-webhook recovery failures and deferred subscriptions as degraded",async()=>{
    h.billing.failed=1;
    expect((await call(ok)).json).toMatchObject({ok:false,billing:{failed:1}});
    h.billing.failed=0;h.billing.deferred=1;
    expect((await call(ok)).json.ok).toBe(false);
    h.billing.deferred=0;h.billing.hasMore=true;
    expect((await call(ok)).json.ok).toBe(false);
  });

  it("records a failed run on the lease when something throws",async()=>{
    h.instances=["a"];h.totalActive=1;
    h.market=undefined as never;
    process.env.MARKET_DATA_MODE="PROVIDER";
    await expect(call(ok)).rejects.toBeDefined();
    expect(h.finishedLease?.status).toBe("FAILED");
  });

  describe("a long reconciliation queue is a backlog, not a failure",()=>{
    it("reports healthy (HTTP 200, lease SUCCESS) while the queue is moving and nothing is badly overdue",async()=>{
      h.instances=["a"];h.totalActive=1;
      h.billing={configured:true,checked:100,failed:0,deferred:0,hasMore:true,recheckHours:5,overdueMs:30*60_000};
      const result=await call(ok);
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({ok:true,status:"backlog",billingBacklog:"BACKLOG"});
      expect(h.finishedLease?.status).toBe("SUCCESS");
    });

    it("also treats a deadline-cut run that made progress as a backlog",async()=>{
      h.billing={configured:true,checked:12,failed:0,deferred:30,hasMore:false,recheckHours:1,overdueMs:0};
      const result=await call(ok);
      expect(result.status).toBe(200);
      expect(result.json).toMatchObject({status:"backlog",billingBacklog:"BACKLOG"});
    });

    it("still fails when no progress was made, so a stuck queue keeps raising the alert",async()=>{
      h.billing={configured:true,checked:0,failed:0,deferred:0,hasMore:true,recheckHours:1,overdueMs:0};
      const result=await call(ok);
      expect(result.status).toBe(503);
      expect(result.json).toMatchObject({ok:false,status:"degraded",billingBacklog:"STALLED"});
      expect(h.finishedLease?.status).toBe("PARTIAL");
    });

    it("still fails when the oldest waiting subscription is overdue beyond the tolerance",async()=>{
      h.billing={configured:true,checked:100,failed:0,deferred:0,hasMore:true,recheckHours:24,overdueMs:7*3_600_000};
      const result=await call(ok);
      expect(result.status).toBe(503);
      expect(result.json).toMatchObject({ok:false,billingBacklog:"STALLED"});
    });

    it("fails closed when the age of the backlog is unknown",async()=>{
      h.billing={configured:true,checked:100,failed:0,deferred:0,hasMore:true,recheckHours:1,overdueMs:null};
      expect((await call(ok)).status).toBe(503);
    });

    it("is not a backlog when individual reconciliations failed",async()=>{
      h.billing={configured:true,checked:90,failed:10,deferred:0,hasMore:true,recheckHours:1,overdueMs:0};
      expect((await call(ok)).json).toMatchObject({ok:false});
    });
  });

  describe("phase isolation",()=>{
    it("keeps calculating and delivering when market data throws, and reports the run degraded",async()=>{
      h.instances=["a","b"];h.totalActive=2;h.throwIn="marketData";
      const result=await call(ok);
      expect(result.status).toBe(503);
      expect(result.json.phaseFailures).toEqual({marketData:"MARKET_PROVIDER_DOWN"});
      expect([...h.calculated].sort()).toEqual(["a","b"]);
      expect(h.aggregatesRan).toBe(1);
      expect(h.finishedLease?.status).toBe("PARTIAL");
    });

    it("keeps later phases running when billing, deletions or deliveries throw",async()=>{
      for(const phase of ["billing","deletions","deliveries"]){
        Object.assign(h,{instances:["a"],totalActive:1,calculated:[],aggregatesRan:0,throwIn:phase,finishedLease:null,retentionCalls:[]});
        const result=await call(ok);
        expect(result.status,phase).toBe(503);
        expect(Object.keys(result.json.phaseFailures),phase).toHaveLength(1);
        expect(h.calculated,phase).toEqual(["a"]);
        expect(h.aggregatesRan,phase).toBe(1);
        expect(h.retentionCalls,phase).toHaveLength(1);
      }
    });

    it("a failing aggregates phase does not skip retention and is reported without raw messages",async()=>{
      h.throwIn="aggregates";
      const result=await call(ok);
      expect(result.json.phaseFailures).toEqual({aggregates:"AGGREGATES_BROKEN"});
      expect(h.retentionCalls).toHaveLength(1);
    });
  });

  describe("retention phase",()=>{
    it("runs after the main work with the lease id and a deadline inside the budget",async()=>{
      process.env.CRON_TIME_BUDGET_MS="60000";
      const before=Date.now();
      const result=await call(ok);
      expect(result.status).toBe(200);
      expect(h.retentionCalls).toHaveLength(1);
      expect(h.retentionCalls[0].currentRunId).toBe("lease-1");
      const deadline=Number(h.retentionCalls[0].deadline);
      expect(deadline).toBeGreaterThan(before);
      expect(deadline).toBeLessThanOrEqual(Date.now()+60_000);
    });

    it("reports a failed cleanup step as degraded without failing the run",async()=>{
      h.retention={deleted:{},failed:{rate_limits:"Error"},deferred:0};
      const result=await call(ok);
      expect(result.status).toBe(503);
      expect(result.json.phaseFailures.retention).toMatch(/^RETENTION_STEP_FAILED/);
      expect(h.finishedLease?.status).toBe("PARTIAL");
    });

    it("reports a throwing cleanup as degraded",async()=>{
      h.throwIn="retention";
      const result=await call(ok);
      expect(result.json.phaseFailures).toEqual({retention:"RETENTION_BROKEN"});
    });
  });

  describe("time budget",()=>{
    it("exports a numeric maxDuration and derives the default budget from it",async()=>{
      const route=await import("@/app/api/cron/actions/route");
      expect(route.maxDuration).toBe(300);
      delete process.env.CRON_TIME_BUDGET_MS;
      await call(ok);
      // Default budget is half of maxDuration (150 s); the retention deadline is 98% of it.
      const remaining=Number(h.retentionCalls[0].deadline)-Date.now();
      expect(remaining).toBeGreaterThan(140_000);
      expect(remaining).toBeLessThanOrEqual(150_000);
    });

    it("never lets CRON_TIME_BUDGET_MS exceed the platform limit on Vercel",async()=>{
      process.env.VERCEL="1";process.env.CRON_TIME_BUDGET_MS="10000000";
      await call(ok);
      expect(Number(h.retentionCalls[0].deadline)-Date.now()).toBeLessThanOrEqual(270_000);
    });
  });
});
