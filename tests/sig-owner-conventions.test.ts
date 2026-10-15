import {describe,expect,it} from "vitest";
import {assessWealtharr9SigDailySpike,validateWealtharrIncomeModelWeights,
  WEALTHARR_SIG_OWNER_RULES} from "@/domain/strategy/sig-owner-conventions";

const base={
  previousQuarterTqqqClose:"40",
  observationTqqqClose:"80",
  previousQuarterLastTradingDay:"2026-03-31",
  observationDate:"2026-04-15",
  verifiedDailyClose:true,
  in30DownProtection:false,
  stockValue:"6500",bondValue:"3500"
};
describe("owner-labelled Wealtharr Sig conventions",()=>{
  it("records explicit 3Sig, 6Sig, 9Sig and income variants",()=>{
    expect(WEALTHARR_SIG_OWNER_RULES.threeSig.protectionSellSkips).toBe(4);
    expect(WEALTHARR_SIG_OWNER_RULES.sixSig.protectionSellSkips).toBe(2);
    expect(WEALTHARR_SIG_OWNER_RULES.nineSig.protectionReference).toBe("TQQQ");
    expect(WEALTHARR_SIG_OWNER_RULES.nineSig.targetAfterCappedBuy).toBe("CONFIRMED_POST_FILL");
    expect(WEALTHARR_SIG_OWNER_RULES.income.variant).toBe("WEALTHARR_INCOME_MODEL");
  });
  it("produces a daily-close 100% spike candidate without fabricating a trade",()=>{
    expect(assessWealtharr9SigDailySpike(base)).toEqual({
      triggered:true,targetStockWeight:"0.60",gain:"1"
    });
    expect(assessWealtharr9SigDailySpike({...base,observationTqqqClose:"79.99"}).triggered).toBe(false);
    expect(assessWealtharr9SigDailySpike({...base,in30DownProtection:true}).triggered).toBe(false);
  });
  it("fails closed on unverified close, bad dates and invalid assets",()=>{
    expect(()=>assessWealtharr9SigDailySpike({...base,verifiedDailyClose:false}))
      .toThrow("SIG_DAILY_CLOSE_NOT_VERIFIED");
    expect(()=>assessWealtharr9SigDailySpike({...base,observationDate:"2026-03-31"}))
      .toThrow("SIG_INVALID_SPIKE_OBSERVATION_DATE");
    expect(()=>assessWealtharr9SigDailySpike({...base,stockValue:"-1"}))
      .toThrow("SIG_INVALID_PORTFOLIO");
  });
  it("requires complete immutable income allocation inputs",()=>{
    expect(()=>validateWealtharrIncomeModelWeights({
      generatorWeights:["0.4","0.3","0.3"],reserveWeights:["0.6","0.4"],skimFraction:"0.5"
    })).not.toThrow();
    expect(()=>validateWealtharrIncomeModelWeights({
      generatorWeights:["0.4","0.3","0.2"],reserveWeights:["1"],skimFraction:"0.5"
    })).toThrow("SIG_INCOME_GENERATOR_WEIGHTS");
    expect(()=>validateWealtharrIncomeModelWeights({
      generatorWeights:["0.4","0.3","0.3"],reserveWeights:["1"],skimFraction:"1.01"
    })).toThrow("SIG_INCOME_SKIM_FRACTION");
  });
});
