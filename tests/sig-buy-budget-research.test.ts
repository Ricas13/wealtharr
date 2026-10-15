import {describe,expect,it} from "vitest";
import {affordableSigResearchBuy,recordSigBuyFill,remainingSigBuyBudget} from "../src/domain/strategy/sig-buy-budget-research";
describe("review-scoped Sig buy budget (research only)",()=>{
  const initial={reviewId:"2026-Q3",startingReserve:"2109.40",fraction:"0.90",filledBuys:"0"};
  it("caps all confirmed partial fills at the same quarter-open budget, never a rolling 90%",()=>{
    expect(remainingSigBuyBudget(initial)).toBe("1898.46");
    expect(affordableSigResearchBuy(initial,"4205.87","2109.40")).toBe("1898.46");
    const partiallyFilled=recordSigBuyFill(initial,"1000");
    expect(affordableSigResearchBuy(partiallyFilled,"3205.87","1109.40")).toBe("898.46");
    const complete=recordSigBuyFill(partiallyFilled,"898.46");
    expect(remainingSigBuyBudget(complete)).toBe("0");
    expect(affordableSigResearchBuy(complete,"10000","210.94")).toBe("0");
    expect(()=>recordSigBuyFill(complete,"0.01")).toThrow("SIG_BUY_BUDGET_OVERFILLED");
  });
  it("does not consume budget on a proposed buy and respects actual available reserve",()=>{
    expect(affordableSigResearchBuy(initial,"500","100")).toBe("100");
    expect(remainingSigBuyBudget(initial)).toBe("1898.46");
  });
  it("rejects corrupted monetary state",()=>{
    expect(()=>remainingSigBuyBudget({...initial,fraction:"1.01"})).toThrow("INVALID_SIG_BUDGET");
    expect(()=>recordSigBuyFill({...initial,filledBuys:"2000"},"0")).toThrow("SIG_BUY_BUDGET_OVERFILLED");
    expect(()=>remainingSigBuyBudget({...initial,reviewId:"no"})).toThrow("INVALID_SIG_BUDGET");
  });
});
