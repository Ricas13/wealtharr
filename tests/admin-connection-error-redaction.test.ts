import {describe,expect,it,vi} from "vitest";

vi.mock("@/lib/session",()=>({requireAdmin:async()=>({id:"admin-test",email:"admin@example.test"})}));
vi.mock("@/lib/security",()=>({assertSameOrigin:()=>{}}));
vi.mock("@/lib/settings",()=>({ensureSettings:async()=>{}}));
vi.mock("@/lib/db",()=>({sql:{unsafe:async()=>[]}}));
vi.mock("@/lib/market-data",()=>({
  getMarketDataProvider:()=>({
    name:"http",configured:true,
    currentPrice:async()=>{throw new Error("Provider failed with internal credential FAKE_PRIVATE_VALUE");},
    historicalPrice:async()=>null
  })
}));

describe("Master Admin connection test redaction",()=>{
  it("does not reflect arbitrary provider exceptions or sensitive values to the browser",async()=>{
    const {POST}=await import("@/app/api/admin/operations/test-connection/route");
    const request=new Request("http://localhost/api/admin/operations/test-connection",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({service:"MARKET_DATA",symbol:"QQQ"})
    });
    const response=await POST(request);
    expect(response.status).toBe(503);
    const payload=await response.text();
    expect(payload).toContain("Provider test failed");
    expect(payload).not.toContain("FAKE_PRIVATE_VALUE");
    expect(payload).not.toContain("Provider failed with internal credential");
  });
});
