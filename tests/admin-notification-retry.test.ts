import {describe,expect,it,vi} from "vitest";

const seen=vi.hoisted(()=>({query:"",params:[] as unknown[]}));
vi.mock("@/lib/session",()=>({requireAdmin:async()=>({id:"admin-test"})}));
vi.mock("@/lib/security",()=>({assertSameOrigin:()=>{}}));
vi.mock("@/lib/db",()=>({
  sql:{begin:async(fn:(tx:unknown)=>unknown)=>fn({
    unsafe:async(query:string,params:unknown[])=>{
      if(query.includes("SELECT d.id")){
        seen.query=query;
        seen.params=params;
        return [{id:"00000000-0000-4000-8000-000000000001"}];
      }
      return [];
    }
  })}
}));
describe("Master Admin notification retry",()=>{
  it("accepts Telegram and can retry transient action revalidation failures",async()=>{
    const {POST}=await import("@/app/api/admin/operations/retry-deliveries/route");
    const response=await POST(new Request("http://localhost/api/admin/operations/retry-deliveries",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({channel:"TELEGRAM",limit:1})
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ok:true,queued:1});
    expect(seen.params[0]).toBe("TELEGRAM");
    expect(seen.query).toContain("ACTION_REVALIDATION_FAILED");
    expect(seen.query).toContain("FOR UPDATE OF d SKIP LOCKED");
  });
});
