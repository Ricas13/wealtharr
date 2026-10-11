import { describe,expect,it } from "vitest";
import { exposureLeverage, resolveMapping } from "../src/domain/instruments";

const base={
  economicExposure:"NASDAQ_100_3X_LONG",
  leverage:"3.000000",
  direction:"LONG",
  country:"GB",
  wrapper:"ISA",
  broker:null,
  preferredCurrency:"GBP",
  fidelity:"EXACT",
  effectiveFrom:"2026-01-01",
  effectiveTo:null,
  tradingLineCurrency:"GBP",
  tradingLineEffectiveFrom:"2026-01-01",
  tradingLineEffectiveTo:null
};

describe("regional instrument resolver",()=>{
  it("fails closed when equally ranked mappings point at different trading lines",()=>{
    const request={economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",broker:null,preferredCurrency:"GBP",asOf:"2026-10-01"};
    expect(resolveMapping([
      {id:"x",tradingLineId:"a",...base},
      {id:"y",tradingLineId:"b",...base}
    ],request)).toBeNull();
  });
  it("permits duplicate records only if they identify the same exact trading line",()=>{
    const request={economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",broker:null,preferredCurrency:"GBP",asOf:"2026-10-01"};
    expect(resolveMapping([
      {id:"x",tradingLineId:"a",...base},
      {id:"y",tradingLineId:"a",...base}
    ],request)?.tradingLineId).toBe("a");
  });

  it("supports arbitrary leverage rather than only 1X and 3X",()=>{
    expect(exposureLeverage("NASDAQ_100_2X_LONG")).toBe("2");
    expect(exposureLeverage("CUSTOM_EXPOSURE","1.5")).toBe("1.5");
    expect(exposureLeverage("CUSTOM_EXPOSURE")).toBe("1");
  });

  it("prefers a broker-specific exact mapping",()=>{
    const result=resolveMapping([
      {id:"generic",tradingLineId:"a",...base},
      {id:"specific",tradingLineId:"b",...base,broker:"Example Broker"}
    ],{economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",broker:"Example Broker",preferredCurrency:"GBP",asOf:"2026-10-01"});
    expect(result?.id).toBe("specific");
  });

  it("does not use a broker-specific mapping when no broker was supplied",()=>{
    const result=resolveMapping(
      [{id:"specific",tradingLineId:"b",...base,broker:"Example Broker"}],
      {economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",broker:null,preferredCurrency:"GBP",asOf:"2026-10-01"}
    );
    expect(result).toBeNull();
  });

  it("ignores corrupt leverage records without throwing or hiding a valid mapping",()=>{
    const request={economicExposure:base.economicExposure,leverage:"3",direction:"LONG",
      country:"GB",wrapper:"ISA",preferredCurrency:"GBP",asOf:"2026-10-01"};
    const malformed=["not-a-number","Infinity","NaN","0","-3"];
    for(const leverage of malformed){
      const invalid={id:"bad",tradingLineId:"bad-line",...base,leverage};
      const valid={id:"valid",tradingLineId:"valid-line",...base};
      expect(resolveMapping([invalid,valid],request)?.tradingLineId).toBe("valid-line");
      expect(resolveMapping([invalid],request)).toBeNull();
    }
    expect(resolveMapping([{id:"valid",tradingLineId:"valid-line",...base}],
      {...request,leverage:"NaN"})).toBeNull();
  });

  it("refuses economically different leverage",()=>{
    const result=resolveMapping(
      [{id:"x",tradingLineId:"a",...base,leverage:"2.000000"}],
      {economicExposure:base.economicExposure,leverage:"3.000000",direction:"LONG",country:"GB",wrapper:"ISA",preferredCurrency:"GBP",asOf:"2026-10-01"}
    );
    expect(result).toBeNull();
  });

  it("refuses a trading line in the wrong currency when no FX implementation exists",()=>{
    const result=resolveMapping(
      [{id:"x",tradingLineId:"a",...base,tradingLineCurrency:"USD"}],
      {economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",preferredCurrency:"GBP",asOf:"2026-10-01"}
    );
    expect(result).toBeNull();
  });

  it("refuses an expired trading line even when the mapping is still enabled",()=>{
    const result=resolveMapping(
      [{id:"x",tradingLineId:"a",...base,tradingLineEffectiveTo:"2026-09-30"}],
      {economicExposure:base.economicExposure,leverage:base.leverage,direction:"LONG",country:"GB",wrapper:"ISA",preferredCurrency:"GBP",asOf:"2026-10-01"}
    );
    expect(result).toBeNull();
  });
});

describe("currency matching",()=>{
  const candidate={
    id:"m1",economicExposure:"NASDAQ_100_3X_LONG",leverage:"3",direction:"LONG",country:"GB",wrapper:"ISA",broker:null,
    preferredCurrency:"GBP",fidelity:"EXACT",effectiveFrom:"2020-01-01",effectiveTo:null,tradingLineId:"line-1",
    tradingLineCurrency:"GBP",tradingLineEffectiveFrom:"2020-01-01",tradingLineEffectiveTo:null
  };
  const request={economicExposure:"NASDAQ_100_3X_LONG",leverage:"3",direction:"LONG",country:"GB",wrapper:"ISA",asOf:"2030-01-01"};

  it("resolves a mapping for an account whose currency was stored in lower case",()=>{
    expect(resolveMapping([candidate],{...request,preferredCurrency:"gbp"})?.tradingLineId).toBe("line-1");
    expect(resolveMapping([{...candidate,tradingLineCurrency:"gbp",preferredCurrency:"gbp"}],{...request,preferredCurrency:"GBP"})?.tradingLineId).toBe("line-1");
  });

  it("still refuses a different currency",()=>{
    expect(resolveMapping([candidate],{...request,preferredCurrency:"usd"})).toBeNull();
  });
});
