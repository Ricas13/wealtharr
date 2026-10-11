import {describe,expect,it} from "vitest";
import {masterSetupSignals,type MasterSetupInputs} from "@/domain/master-setup";
const fixture:MasterSetupInputs={
  publicUrl:false,brand:false,mfa:false,stripe:false,email:false,market:false,
  notifications:false,indexing:false,plans:0,publishedStrategies:0,approvedMappings:0,
  lastCronAt:null,backupAt:null,backupExpected:false,attestations:false,now:new Date("2026-10-09T14:00:00Z")
};
describe("Master Admin setup checklist",()=>{
  it("does not consider a missing provider, job or portfolio ready",()=>{
    const signals=masterSetupSignals(fixture);
    expect(signals.length).toBeGreaterThan(10);
    expect(signals.every(x=>x.status!=="configured")).toBe(true);
  });
  it("never confuses an approved mapping count or manual sign-off with evidence",()=>{
    const signals=masterSetupSignals({...fixture,publishedStrategies:10,approvedMappings:50,attestations:true});
    for(const name of ["catalogue","instruments","launch"])
      expect(signals.find(x=>x.id===name)?.status).toBe("requires-verification");
  });
  it("requires recent successful background and backup executions",()=>{
    const signals=masterSetupSignals({...fixture,lastCronAt:new Date("2026-10-09T13:00:00Z"),backupAt:new Date("2026-10-09T12:00:00Z"),backupExpected:true});
    expect(signals.find(x=>x.id==="workers")?.status).toBe("configured");
    expect(signals.find(x=>x.id==="backup")?.status).toBe("requires-verification");
    const stale=masterSetupSignals({...fixture,lastCronAt:new Date("2026-10-09T10:00:00Z"),backupAt:new Date("2026-10-07T00:00:00Z"),backupExpected:true});
    expect(stale.find(x=>x.id==="workers")?.status).toBe("needs-setup");
    expect(stale.find(x=>x.id==="backup")?.status).toBe("needs-setup");
  });
  it("links each configuration item to an actionable admin surface",()=>{
    const signals=masterSetupSignals(fixture);
    expect(new Set(signals.map(x=>x.id)).size).toBe(signals.length);
    expect(signals.every(x=>x.href.startsWith("/admin/"))).toBe(true);
  });
});
