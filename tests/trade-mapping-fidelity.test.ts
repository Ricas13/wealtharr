import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolveMapping,type MappingCandidate} from "@/domain/instruments";

describe("trade instruction instrument identity and country suitability",()=>{
  const code=readFileSync("src/lib/action-service.ts","utf8");
  it("joins trading line to its verified real economic exposure, direction and leverage before asking for a buy",()=>{
    expect(code).toContain("JOIN instruments i ON i.id=tl.instrument_id AND i.economic_exposure=m.economic_exposure AND i.leverage=m.leverage AND i.direction=m.direction");
    expect(code).toContain("m.enabled=true AND m.fidelity='EXACT'");
    expect(code).toContain('preferredCurrency:String(account.currency)');
    expect(code).toContain('broker:account.broker_name?String(account.broker_name):null');
  });
  it("never silently accepts a UK ISA replacement for TMF when its duration exposure is different",()=>{
    const candidate:MappingCandidate={
      id:"wrong-duration",economicExposure:"INTERMEDIATE_TREASURY_3X_LONG",
      leverage:"3",direction:"LONG",country:"GB",wrapper:"ISA",
      broker:null,preferredCurrency:"GBP",fidelity:"EXACT",effectiveFrom:"2026-01-01",effectiveTo:null,
      tradingLineId:"3tyl",tradingLineCurrency:"GBP",tradingLineEffectiveFrom:"2026-01-01",
      tradingLineEffectiveTo:null
    };
    expect(resolveMapping([candidate],{economicExposure:"LONG_TREASURY_3X_LONG",leverage:"3",
      direction:"LONG",country:"GB",wrapper:"ISA",preferredCurrency:"GBP",asOf:"2026-10-09"})).toBeNull();
  });
});
