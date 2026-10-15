import {describe,expect,it} from "vitest";
import {EXPOSURES,getExposure,isFullyDescribedExposure,isRegisteredExposure,type ExposureDefinition} from "@/domain/strategy/exposures";

describe("exposure descriptors",()=>{
  it("keeps every legacy exposure registered and unchanged in leverage",()=>{
    for(const id of ["BROAD_EQUITY","AGGREGATE_BONDS","US_LARGE_CAP","LONG_TREASURY","CASH_BILLS","GOLD"])
      expect(isRegisteredExposure(id),id).toBe(true);
    expect(getExposure("US_EQUITY_3X_LONG")?.leverage).toBe(3);
    expect(getExposure("BROAD_EQUITY")?.leverage).toBe(1);
  });

  it("qualifies the Group 2 broad equity sleeve without fabricating a tradable fund",()=>{
    expect(isFullyDescribedExposure(getExposure("BROAD_EQUITY"))).toBe(true);
    expect(isFullyDescribedExposure(getExposure("AGGREGATE_BONDS"))).toBe(false);
    expect(isFullyDescribedExposure(undefined)).toBe(false);
  });

  it("defines the 60/40 model exposures precisely and as an owner-confirmed convention",()=>{
    const equity=getExposure("GLOBAL_EQUITY_ALL_CAP_UNHEDGED");
    const bonds=getExposure("GLOBAL_AGGREGATE_BONDS_GBP_HEDGED");
    expect(isFullyDescribedExposure(equity)).toBe(true);
    expect(isFullyDescribedExposure(bonds)).toBe(true);
    expect(equity).toMatchObject({assetClass:"EQUITY",leverage:1,currencyPolicy:"UNHEDGED",modelConvention:true});
    expect(bonds).toMatchObject({assetClass:"BOND",leverage:1,currencyPolicy:"GBP_HEDGED",
      maturityBand:"ALL_MATURITIES",creditQuality:"INVESTMENT_GRADE",modelConvention:true});
  });

  it("incomplete descriptors are rejected one field at a time",()=>{
    const full=getExposure("GLOBAL_EQUITY_ALL_CAP_UNHEDGED")!;
    for(const field of ["region","maturityBand","currencyPolicy","creditQuality","coverage","domicileRequirement"] as const){
      const copy:Record<string,unknown>={...full};
      delete copy[field];
      expect(isFullyDescribedExposure(copy as ExposureDefinition),field).toBe(false);
    }
    expect(isFullyDescribedExposure({...full,leverage:0})).toBe(false);
    expect(isFullyDescribedExposure({...full,description:" "})).toBe(false);
  });

  it("keeps ids unique and never puts a ticker-like symbol in a description",()=>{
    expect(new Set(EXPOSURES.map(e=>e.id)).size).toBe(EXPOSURES.length);
    for(const e of EXPOSURES)expect(e.description,e.id).not.toMatch(/\b(UPRO|TMF|TQQQ|VTI|SPY|QQQ|VWRL|IGLT)\b/);
  });
});
