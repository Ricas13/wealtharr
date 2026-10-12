import {describe,it,expect} from "vitest";
import {assessFreshness,classifyFreshness,FUTURE_SKEW_MS,MANUAL_PRICE_SKEW_MS,MAX_QUOTE_AGE_MS} from "../src/domain/market-freshness";
import {parseManualOverride} from "../src/domain/manual-override";
describe("market data freshness",()=>{
  const now=new Date("2026-10-08T10:00:00Z");
  it("accepts recent observed data",()=>expect(classifyFreshness(new Date("2026-10-08T09:00:00Z"),now)).toBe("CURRENT"));
  it("rejects stale data",()=>expect(classifyFreshness(new Date("2026-10-01T00:00:00Z"),now)).toBe("STALE"));
  it("rejects future timestamps",()=>expect(classifyFreshness(new Date("2026-10-09T00:00:00Z"),now)).toBe("STALE"));
  it("rejects invalid dates",()=>expect(classifyFreshness(new Date("invalid"),now)).toBe("STALE"));
});

describe("assessFreshness",()=>{
  const now=new Date("2026-10-08T10:00:00Z");
  const at=(offsetMs:number)=>new Date(now.getTime()+offsetMs);
  it("treats a quote a few seconds ahead of server time as current",()=>{
    expect(assessFreshness(at(5_000),now)).toBe("CURRENT");
    expect(classifyFreshness(at(5_000),now)).toBe("CURRENT");
  });
  it("applies the skew inclusively and refuses anything further ahead",()=>{
    expect(assessFreshness(at(FUTURE_SKEW_MS),now)).toBe("CURRENT");
    expect(assessFreshness(at(FUTURE_SKEW_MS+1),now)).toBe("STALE");
  });
  it("applies the age limit inclusively",()=>{
    expect(assessFreshness(at(-MAX_QUOTE_AGE_MS),now)).toBe("CURRENT");
    expect(assessFreshness(at(-MAX_QUOTE_AGE_MS-1),now)).toBe("STALE");
  });
  it("honours per-caller tolerances",()=>{
    expect(assessFreshness(at(MANUAL_PRICE_SKEW_MS),now,{skewMs:MANUAL_PRICE_SKEW_MS})).toBe("CURRENT");
    expect(assessFreshness(at(MANUAL_PRICE_SKEW_MS+1),now,{skewMs:MANUAL_PRICE_SKEW_MS})).toBe("STALE");
    expect(assessFreshness(at(-3_600_001),now,{maxAgeMs:3_600_000})).toBe("STALE");
  });
  it("fails closed on missing or malformed timestamps",()=>{
    expect(assessFreshness(null,now)).toBe("STALE");
    expect(assessFreshness(undefined,now)).toBe("STALE");
    expect(assessFreshness("not a date",now)).toBe("STALE");
    expect(assessFreshness(new Date(NaN),now)).toBe("STALE");
  });
  it("is the rule behind manual price evidence, which keeps its 60 second skew",()=>{
    const override=(observedAt:Date)=>parseManualOverride({
      fieldKey:"market_price:123e4567-e89b-12d3-a456-426614174000",manualValue:"10",reason:"Broker reference price",
      observedAt:observedAt.toISOString(),confirmed:true
    },now);
    expect(()=>override(at(60_000))).not.toThrow();
    expect(()=>override(at(60_001))).toThrow("OVERRIDE_PRICE_STALE");
    expect(()=>override(at(-MAX_QUOTE_AGE_MS-1))).toThrow("OVERRIDE_PRICE_STALE");
  });
});
