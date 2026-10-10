import {beforeEach,describe,expect,it,vi} from "vitest";

const seen=vi.hoisted(()=>({settings:0,queries:0}));
vi.mock("@/lib/settings",()=>({ensureSettings:async()=>{seen.settings+=1;}}));
vi.mock("@/lib/db",()=>({sql:{unsafe:async()=>{seen.queries+=1;return [];}}}));
vi.mock("@/lib/ops-monitor",()=>({runOpsCheck:async()=>({alerts:[],notified:0,resolved:0,recipients:0,enabled:false})}));

describe("protected scheduler health and heartbeat endpoints",()=>{
  beforeEach(()=>{process.env.CRON_SECRET="example-cron-secret";seen.settings=0;seen.queries=0;});
  it("rejects unauthenticated health requests without reading settings or database state",async()=>{
    const {GET}=await import("@/app/api/cron/health/route");
    const response=await GET(new Request("http://localhost/api/cron/health"));
    expect(response.status).toBe(401);
    expect(seen).toEqual({settings:0,queries:0});
  });
  it("rejects unauthenticated backup heartbeats without IO",async()=>{
    const {POST}=await import("@/app/api/cron/heartbeat/route");
    const response=await POST(new Request("http://localhost/api/cron/heartbeat",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({worker:"backup"})
    }));
    expect(response.status).toBe(401);
    expect(seen).toEqual({settings:0,queries:0});
  });
  it("loads settings after successful shared bearer validation",async()=>{
    const {GET}=await import("@/app/api/cron/health/route");
    const response=await GET(new Request("http://localhost/api/cron/health",{
      headers:{authorization:"Bearer example-cron-secret"}
    }));
    expect(response.status).toBe(200);
    expect(seen.settings).toBe(1);
  });
});
