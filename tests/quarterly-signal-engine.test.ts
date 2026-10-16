import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";
import {getStrategyEngine,assertCustomerPublishableEngine} from "../src/domain/strategy/registry";
import {postActionReviewState} from "../src/domain/strategy/review-completion";
import {sigReviewTradesBySleeve} from "../src/domain/strategy/sig-confirmed-ledger";
import type {EngineContext} from "../src/domain/strategy/types";

const D=(v:Decimal.Value)=>new Decimal(v);
const cfg=()=>({...(getStrategyPlugin("quarterly-target-nasdaq-3x")!.profile!.config as Record<string,unknown>)});
const NINE=["2024-09-30","2024-12-31","2025-03-31","2025-06-30","2025-09-30","2025-12-31","2026-03-31","2026-06-30","2026-09-30"];
const engine=getStrategyEngine("QUARTERLY_SIGNAL_TARGET");
const base=(over:Partial<EngineContext>={}):EngineContext=>({
  strategyInstanceId:"i",strategyVersionId:"v",now:new Date("2026-10-01T15:00:00Z"),baseCurrency:"USD",cash:D(0),
  exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(6000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(4000)}],
  contributionsSinceReview:D(0),state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"},
  config:cfg(),settings:{},reviewDue:true,dataHealth:{status:"CURRENT"},
  trustedHistory:[{exposure:"NASDAQ_100_3X_LONG",currency:"USD",source:"t",
    points:NINE.map(d=>({at:new Date(d+"T00:00:00Z"),adjustedClose:D(100)}))}],
  sigReviewTrades:{stockBuyGross:D(0),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(0),feeTotal:D(0)},
  ...over
} as EngineContext);

describe("engine safety",()=>{
  it("is a customer-publishable engine and rejects bad configuration",()=>{
    expect(()=>assertCustomerPublishableEngine("QUARTERLY_SIGNAL_TARGET")).not.toThrow();
    expect(()=>engine.validateConfig({...cfg(),variant:"SIG_12"})).toThrow("INVALID_QUARTERLY_SIGNAL_CONFIG");
    expect(()=>engine.validateConfig({...cfg(),safeExposure:"NASDAQ_100_3X_LONG"})).toThrow("INVALID_QUARTERLY_SIGNAL_CONFIG");
    expect(()=>engine.validateConfig({...cfg(),buyBudgetRatio:"1.5"})).toThrow("INVALID_QUARTERLY_SIGNAL_CONFIG");
    expect(()=>engine.validateConfig({...cfg(),actWindowTradingDays:0})).toThrow("INVALID_QUARTERLY_SIGNAL_CONFIG");
    expect(()=>engine.validateConfig({...cfg(),protection:{triggerRatio:"0.7",lookbackQuarters:6,skippedSells:2}})).toThrow("INVALID_QUARTERLY_SIGNAL_CONFIG");
    expect(()=>engine.validateConfig(cfg())).not.toThrow();
  });
  it("fails closed on stale data, unmanaged holdings, missing history, missing trades",()=>{
    expect(engine.calculate(base({dataHealth:{status:"STALE",message:"old"}})).actionType).toBe("DATA_REQUIRED");
    expect(engine.calculate(base({exposures:[{economicExposure:"GOLD",value:D(10)}]})).actionType).toBe("DATA_REQUIRED");
    expect(engine.calculate(base({trustedHistory:[]})).actionType).toBe("DATA_REQUIRED");
    expect(engine.calculate(base({sigReviewTrades:undefined})).actionType).toBe("DATA_REQUIRED");
    expect(engine.calculate(base({state:{sigConfirmedAnchor:"x"}})).actionType).toBe("DATA_REQUIRED");
  });
  it("does nothing when no review is due or the latest quarter is already reviewed",()=>{
    expect(engine.calculate(base({reviewDue:false})).actionType).toBe("NO_ACTION");
    expect(engine.calculate(base({state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"}})).actionType).toBe("NO_ACTION");
  });
  it("closes an unfinished review of an earlier quarter instead of blocking forever",()=>{
    const hold=engine.calculate(base({now:new Date("2026-12-31T22:00:00Z"),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",reviewTargetValue:"6540",
        sigReviewKind:"SIGNAL",sigReviewReference:"2026-09-30"}}));
    expect(hold.actionType).toBe("HOLD");
    expect(hold.nextState.sigLastReviewedReference).toBe("2026-09-30");
    expect(hold.nextState.sigConfirmedAnchor).toBe("6000");
  });
  it("carries the in-review markers through trades and clears them on close",()=>{
    const release=engine.calculate(base({exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(5000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(4000)}]}));
    const mid=postActionReviewState(release,{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"},new Date());
    expect(mid.sigReviewKind).toBe("SIGNAL");
    expect(mid.sigReviewReference).toBe("2026-09-30");
    expect(mid.forceReview).toBe(true);
    const close=engine.calculate(base({state:mid,exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(6540)},{economicExposure:"US_AGGREGATE_BONDS",value:D(2460)}]}));
    expect(close.actionType).toBe("HOLD");
    const after=postActionReviewState(close,mid,new Date());
    expect(Object.keys(after).filter(k=>k.startsWith("sigReview"))).toEqual([]);
    expect(after.reviewTargetValue).toBeUndefined();
    expect(after.forceReview).toBe(false);
  });
  it("adds new money received mid-review at half its value to the frozen target",()=>{
    const frozen=engine.calculate(base({exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(6540)},{economicExposure:"US_AGGREGATE_BONDS",value:D(2460)}],
      contributionsSinceReview:D(200),cash:D(200),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",reviewTargetValue:"6540",
        reviewContributionsSnapshot:"0",sigReviewKind:"SIGNAL",sigReviewReference:"2026-09-30"}}));
    // target 6540 + 0.5 x 200 = 6640, gap 100, cash 200 -> buy 100.
    expect(frozen.actionType).toBe("BUY");
    expect(frozen.amount?.toFixed(2)).toBe("100.00");
  });
  it("sweeps idle cash into the safe exposure when the target is met",()=>{
    const sweep=engine.calculate(base({cash:D(500),state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",
      reviewTargetValue:"6000",reviewContributionsSnapshot:"0",sigReviewKind:"SIGNAL",sigReviewReference:"2026-09-30"}}));
    expect([sweep.actionType,sweep.economicExposure,sweep.optionalSweep]).toEqual(["BUY","US_AGGREGATE_BONDS",true]);
    expect(sweep.amount?.toFixed(2)).toBe("500.00");
    expect(sweep.residueCloseState?.sigConfirmedAnchor).toBe("6000");
  });
});

describe("money and rule-version behaviour",()=>{
  it("sizes orders in the account currency, not the reference currency of the price history",()=>{
    const sell=engine.calculate(base({baseCurrency:"GBP",exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(8000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(3000)}]}));
    expect([sell.actionType,sell.currency]).toEqual(["SELL","GBP"]);
    expect(sell.instruction).toContain("GBP");
  });
  it("version 1.0 configs (no withdrawalTargetRatio) leave the line unchanged on withdrawals",()=>{
    const legacy=cfg();delete legacy.withdrawalTargetRatio;
    const step=engine.calculate(base({config:legacy,withdrawalsSinceReview:D(1000),
      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(8000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(3000)}]}));
    expect(step.nextState.targetValue).toBe("6540");
  });
  it("version 1.0 configs (quarter-end spike) never start a review between quarter ends",()=>{
    const legacy={...cfg(),spikeReset:{enabled:true,gainMultiple:"2",targetRatio:"0.60"}};
    const quiet=engine.calculate(base({config:legacy,reviewDue:false,now:new Date("2026-10-20T15:00:00Z"),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"}}));
    expect(quiet.actionType).toBe("NO_ACTION");
  });
  it("carries withdrawals through a missed window",()=>{
    const hold=engine.calculate(base({now:new Date("2026-10-06T15:00:00Z"),withdrawalsSinceReview:D(300)}));
    expect(hold.actionType).toBe("HOLD");
    expect(hold.nextState.sigCarriedWithdrawals).toBe("300");
  });
  it("fails closed between quarter ends when the daily history needed for the spike watch is missing",()=>{
    const missing=engine.calculate(base({reviewDue:false,now:new Date("2026-10-20T15:00:00Z"),trustedHistory:[],
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"}}));
    expect(missing.actionType).toBe("DATA_REQUIRED");
  });
});

describe("NYSE completed-close spike gate",()=>{
  const withIntradayRow=(now:string)=>base({
    now:new Date(now),reviewDue:false,
    state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"},
    trustedHistory:[{exposure:"NASDAQ_100_3X_LONG",currency:"USD",source:"fixture",
      points:[...NINE.map(d=>({at:new Date(d+"T00:00:00Z"),adjustedClose:D(100)})),
        {at:new Date("2026-10-05T00:00:00Z"),adjustedClose:D(200)}]}]
  });
  it("cannot reset from the same trading day's row before the NYSE closing bell",()=>{
    const beforeClose=engine.calculate(withIntradayRow("2026-10-05T15:00:00Z")); // 11:00 New York
    expect(beforeClose.actionType).toBe("NO_ACTION");
    expect(beforeClose.nextState.sigSpikeResetReference).toBeUndefined();
  });
  it("ignores a fabricated weekend daily close even though it is before the current instant",()=>{
    const context=withIntradayRow("2026-10-05T15:00:00Z");
    const trusted=context.trustedHistory![0];
    // 4 October 2026 is Sunday: 200 cannot be an NYSE closing price.
    const suspicious=engine.calculate({
      ...context,trustedHistory:[{...trusted,
        points:[...trusted.points.filter(p=>p.at.toISOString().slice(0,10)!=="2026-10-05"),
          {at:new Date("2026-10-04T00:00:00Z"),adjustedClose:D(200)}]}]
    });
    expect(suspicious.actionType).toBe("NO_ACTION");
  });
  it("can reset after the same day's 16:00 New York close",()=>{
    const afterClose=engine.calculate(withIntradayRow("2026-10-05T21:00:00Z")); // 17:00 New York
    expect(afterClose.actionType).toBe("HOLD");
    expect(afterClose.nextState.sigSpikeResetReference).toBe("2026-09-30");
  });
});

describe("quarterly buy budget is a frozen confirmed opening reserve",()=>{
  const reviewState={
    sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",
    reviewTargetValue:"12000",reviewContributionsSnapshot:"0",
    sigReviewKind:"SIGNAL",sigReviewReference:"2026-09-30",
    sigReviewOpeningReserve:"4000"
  };
  const trades={
    stockBuyGross:D(1000),stockSellGross:D(0),safeBuyGross:D(0),
    safeSellGross:D(0),feeTotal:D(0)
  };
  it("stores the opening reserve in the proposed action and across an executed funding leg",()=>{
    // The 1 October review starts with 4,000 in bonds and no free cash.
    // Its 90% maximum is 3,600; the first 540 of funding must not alter that base.
    const first=engine.calculate(base());
    expect([first.actionType,first.economicExposure,first.amount?.toString()]).toEqual([
      "SELL","US_AGGREGATE_BONDS","540"
    ]);
    expect(first.nextState.sigReviewOpeningReserve).toBe("4000");
    const persisted=postActionReviewState(first,{sigConfirmedAnchor:"6000"},new Date("2026-10-01T15:00:00Z"));
    expect(persisted.sigReviewOpeningReserve).toBe("4000");
  });
  it("keeps the remaining 2,600 cap when bond quotes move after a 1,000 confirmed purchase",()=>{
    // Independent arithmetic: 4,000 * 90% - 1,000 filled = 2,600,
    // so 500 available cash requires a 2,100 bond sale regardless of bond-market drift.
    const oldQuote=engine.calculate(base({
      state:reviewState,cash:D(500),
      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(6000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(3500)}],
      sigReviewTrades:trades
    }));
    const movedQuote=engine.calculate(base({
      state:reviewState,cash:D(500),
      exposures:[{economicExposure:"NASDAQ_100_3X_LONG",value:D(6000)},{economicExposure:"US_AGGREGATE_BONDS",value:D(4200)}],
      sigReviewTrades:trades
    }));
    for(const action of [oldQuote,movedQuote]){
      expect([action.actionType,action.economicExposure,action.amount?.toFixed(2)]).toEqual([
        "SELL","US_AGGREGATE_BONDS","2100.00"
      ]);
      expect(action.nextState.sigReviewOpeningReserve).toBe("4000");
    }
  });
  it("fails closed for old in-flight reviews with confirmed fills but no opening snapshot",()=>{
    const {sigReviewOpeningReserve:ignored,...legacyState}=reviewState;
    void ignored;
    const unsafe=engine.calculate(base({
      state:legacyState,cash:D(500),sigReviewTrades:trades
    }));
    expect([unsafe.actionType,unsafe.title]).toEqual(["DATA_REQUIRED","Opening reserve needs reconciliation"]);
  });
});

describe("sigReviewTradesBySleeve",()=>{
  const at=new Date("2026-09-30T20:00:00Z");
  const row=(over:Record<string,unknown>)=>({id:"a",correctionOfEventId:null,eventType:"BUY",currency:"USD",cashAmount:"-100",
    feeAmount:"0",occurredAt:new Date("2026-10-01T15:00:00Z"),exposure:"NASDAQ_100_3X_LONG",...over}) as never;
  it("splits fills by sleeve, ignores earlier and corrected rows, and adds fees",()=>{
    const rows=[row({id:"1",cashAmount:"-100",feeAmount:"1"}),row({id:"2",eventType:"SELL",cashAmount:"50",exposure:"US_AGGREGATE_BONDS"}),
      row({id:"3",occurredAt:new Date("2026-09-01T00:00:00Z")}),row({id:"4"}),row({id:"5",eventType:"CORRECTION",correctionOfEventId:"4",cashAmount:"0"})];
    const t=sigReviewTradesBySleeve(rows,at,"USD","NASDAQ_100_3X_LONG","US_AGGREGATE_BONDS");
    expect([t.stockBuyGross,t.safeSellGross,t.stockSellGross,t.safeBuyGross,t.feeTotal].map(String)).toEqual(["100","50","0","0","1"]);
  });
  it("fails closed on an unmapped execution or a foreign currency",()=>{
    expect(()=>sigReviewTradesBySleeve([row({exposure:null})],at,"USD","NASDAQ_100_3X_LONG","US_AGGREGATE_BONDS")).toThrow("SIG_UNMANAGED_EXECUTION");
    expect(()=>sigReviewTradesBySleeve([row({currency:"GBP"})],at,"USD","NASDAQ_100_3X_LONG","US_AGGREGATE_BONDS")).toThrow("SIG_EXECUTION_CURRENCY_MISMATCH");
  });
});
