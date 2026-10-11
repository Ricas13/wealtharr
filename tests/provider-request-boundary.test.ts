import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";

const source=(path:string)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

describe("outbound provider request safety",()=>{
  it("rejects unexpected redirects instead of following a configured vendor to another host",()=>{
    for(const path of ["src/lib/market-data.ts","src/lib/email.ts","src/lib/notification-service.ts"]){
      expect(source(path)).toMatch(/redirect:\s*"error"/);
    }
  });
  it("persists redacted market-provider errors rather than arbitrary exception details",()=>{
    const worker=source("src/lib/market-data-worker.ts");
    expect(worker).toContain('code: "PROVIDER_REQUEST_FAILED"');
    expect(worker).toContain('error: "MARKET_DATA_WORKER_FAILED"');
    expect(worker).not.toContain("error.message.slice");
  });
});
