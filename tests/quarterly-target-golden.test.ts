import {describe,expect,it} from "vitest";
import Decimal from "decimal.js";
import {getStrategyPlugin} from "../src/domain/strategy/catalog";
import {getStrategyEngine} from "../src/domain/strategy/registry";
import {postActionReviewState} from "../src/domain/strategy/review-completion";
import type {EngineContext,ProposedAction} from "../src/domain/strategy/types";

/**
 * Golden cases for the quarterly target family. Every expected number below was worked out by hand
 * (the workings are in the comments) and is NOT produced by calling the engine to learn its answer.
 *
 * Reference quarter used throughout: Q3 2026, last NYSE trading day Wednesday 2026-09-30.
 * The nine quarter-end trading days ending there, written out in full (no helper):
 */
const NINE_DATES=["2024-09-30","2024-12-31","2025-03-31","2025-06-30","2025-09-30","2025-12-31","2026-03-31","2026-06-30","2026-09-30"];
const Q3_2026_INDEX=2026*4+2; // 8106
const D=(v:Decimal.Value)=>new Decimal(v);
const KEYS=["quarterly-target-nasdaq-3x","quarterly-target-midcap-2x","quarterly-target-smallcap"] as const;
type Key=(typeof KEYS)[number];

function config(key:Key){
  const plugin=getStrategyPlugin(key)!;
  return {...(plugin.profile!.config as Record<string,unknown>)};
}
function ctx(key:Key,over:Omit<Partial<EngineContext>,"now">&{closes?:string[];now?:string}={}):EngineContext{
  const cfg=config(key);
  const closes=over.closes??Array(9).fill("100");
  return {
    strategyInstanceId:"i",strategyVersionId:"v",now:new Date(over.now??"2026-10-01T15:00:00Z"),baseCurrency:"USD",
    cash:D(0),exposures:[],contributionsSinceReview:D(0),state:{},config:cfg,settings:{},reviewDue:true,
    dataHealth:{status:"CURRENT"},
    trustedHistory:[{exposure:String(cfg.targetExposure),currency:"USD",source:"fixture",
      points:NINE_DATES.map((d,i)=>({at:new Date(d+"T00:00:00Z"),adjustedClose:D(closes[i])}))}],
    sigReviewTrades:{stockBuyGross:D(0),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(0),feeTotal:D(0)},
    ...Object.fromEntries(Object.entries(over).filter(([k])=>k!=="closes"&&k!=="now"))
  } as EngineContext;
}
const run=(c:EngineContext)=>getStrategyEngine("QUARTERLY_SIGNAL_TARGET").calculate(c);
const stockOf=(key:Key,value:string)=>({economicExposure:String(config(key).targetExposure),value:D(value)});
const bondOf=(value:string)=>({economicExposure:"US_AGGREGATE_BONDS",value:D(value)});
const amount=(a:ProposedAction)=>a.amount?.toFixed(2);

describe("registered plugins",()=>{
  it("declares the three variants with their hand-set growth and skip counts",()=>{
    const rows=KEYS.map(k=>{const c=config(k);return [k,c.quarterlyGrowth,(c.protection as {skippedSells:number}).skippedSells,c.targetExposure];});
    expect(rows).toEqual([
      ["quarterly-target-nasdaq-3x","0.09",2,"NASDAQ_100_3X_LONG"],
      ["quarterly-target-midcap-2x","0.06",2,"US_MID_CAP_2X_LONG"],
      ["quarterly-target-smallcap","0.03",4,"US_SMALL_CAP_BLEND"]
    ]);
  });
});

describe("quarterly-target-nasdaq-3x golden cases",()=>{
  const key:Key="quarterly-target-nasdaq-3x";
  it("starts 60/40: buy 6000 of 10000, then sweep the remaining 4000 into the bond fund, then close at anchor 6000",()=>{
    // total 10000, initial target 0.60 x 10000 = 6000.
    let state:Record<string,unknown>={forceReview:true};
    const now="2026-10-15T15:00:00Z";
    const first=run(ctx(key,{now,cash:D(10000),state}));
    expect([first.actionType,amount(first),first.economicExposure]).toEqual(["BUY","6000.00","NASDAQ_100_3X_LONG"]);
    state=postActionReviewState(first,state,new Date(now));
    const second=run(ctx(key,{now,cash:D(4000),exposures:[stockOf(key,"6000")],state}));
    expect([second.actionType,amount(second),second.economicExposure]).toEqual(["BUY","4000.00","US_AGGREGATE_BONDS"]);
    state=postActionReviewState(second,state,new Date(now));
    const third=run(ctx(key,{now,cash:D(0),exposures:[stockOf(key,"6000"),bondOf("4000")],state}));
    expect(third.actionType).toBe("HOLD");
    expect(third.nextState.sigConfirmedAnchor).toBe("6000");
    // latest completed quarter end on 2026-10-15 is 2026-09-30: the first signal review is 2026-12-31.
    expect(third.nextState.sigLastReviewedReference).toBe("2026-09-30");
  });

  it("underfunded buy: target 6000 x 1.09 = 6540, stock fell to 5000, gap 1540 funded by releasing 1540 of bonds, then buying 1540",()=>{
    let state:Record<string,unknown>={sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",sigProtection:{startQuarter:null,skippedSellCount:0}};
    const base={exposures:[stockOf(key,"5000"),bondOf("4000")]};
    const release=run(ctx(key,{...base,cash:D(0),state}));
    // budget 0.9 x (4000 + 0) = 3600 >= gap 1540 and reserve 4000: x = 1540, no cash so release bonds.
    expect([release.actionType,amount(release),release.economicExposure]).toEqual(["SELL","1540.00","US_AGGREGATE_BONDS"]);
    state=postActionReviewState(release,state,new Date("2026-10-01T15:00:00Z"));
    expect(state.reviewTargetValue).toBe("6540");
    const buy=run(ctx(key,{exposures:[stockOf(key,"5000"),bondOf("2460")],cash:D(1540),state,
      sigReviewTrades:{stockBuyGross:D(0),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(1540),feeTotal:D(0)}}));
    expect([buy.actionType,amount(buy),buy.economicExposure]).toEqual(["BUY","1540.00","NASDAQ_100_3X_LONG"]);
    state=postActionReviewState(buy,state,new Date("2026-10-01T15:00:00Z"));
    const close=run(ctx(key,{exposures:[stockOf(key,"6540"),bondOf("2460")],cash:D(0),state,
      sigReviewTrades:{stockBuyGross:D(1540),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(1540),feeTotal:D(0)}}));
    expect(close.actionType).toBe("HOLD");
    expect(close.nextState.sigConfirmedAnchor).toBe("6540");
    expect(close.nextState.sigLastReviewedReference).toBe("2026-09-30");
  });

  it("90% purchase throttle: reserve 2000, budget 1800 of a 3540 gap; second pass has no budget left and closes at 4800",()=>{
    // anchor 6000 -> target 6540; stock 3000 -> gap 3540; opening reserve 2000 -> budget 0.9 x 2000 = 1800.
    let state:Record<string,unknown>={sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"};
    const release=run(ctx(key,{exposures:[stockOf(key,"3000"),bondOf("2000")],cash:D(0),state}));
    expect([release.actionType,amount(release)]).toEqual(["SELL","1800.00"]);
    state=postActionReviewState(release,state,new Date("2026-10-01T15:00:00Z"));
    const buy=run(ctx(key,{exposures:[stockOf(key,"3000"),bondOf("200")],cash:D(1800),state,
      sigReviewTrades:{stockBuyGross:D(0),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(1800),feeTotal:D(0)}}));
    expect([buy.actionType,amount(buy),buy.economicExposure]).toEqual(["BUY","1800.00","NASDAQ_100_3X_LONG"]);
    state=postActionReviewState(buy,state,new Date("2026-10-01T15:00:00Z"));
    // opening reserve = 200 + 0 + 1800 buys = 2000; budget = 1800 - 1800 = 0.
    const close=run(ctx(key,{exposures:[stockOf(key,"4800"),bondOf("200")],cash:D(0),state,
      sigReviewTrades:{stockBuyGross:D(1800),stockSellGross:D(0),safeBuyGross:D(0),safeSellGross:D(1800),feeTotal:D(0)}}));
    expect(close.actionType).toBe("HOLD");
    expect(close.nextState.sigConfirmedAnchor).toBe("4800");
  });

  it("sell signal: anchor 6000 x 1.09 = 6540, stock 8000, sell 1460",()=>{
    const sell=run(ctx(key,{exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([sell.actionType,amount(sell),sell.economicExposure]).toEqual(["SELL","1460.00","NASDAQ_100_3X_LONG"]);
  });

  it("new money lifts the line by half: 6000 x 1.09 + 0.5 x 1000 = 7040; stock 6000, cash 1000, gap 1040: release 40 of bonds",()=>{
    const step=run(ctx(key,{exposures:[stockOf(key,"6000"),bondOf("4000")],cash:D(1000),contributionsSinceReview:D(1000),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([step.actionType,amount(step),step.economicExposure]).toEqual(["SELL","40.00","US_AGGREGATE_BONDS"]);
    expect(step.nextState.targetValue).toBe("7040");
  });

  it("30 Down: close 70 vs highest of the previous eight (100) skips the sell; anchor becomes the actual 8000",()=>{
    const closes=[...Array(8).fill("100"),"70"];
    const hold=run(ctx(key,{closes,exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect(hold.actionType).toBe("HOLD");
    expect(hold.nextState.sigProtection).toEqual({startQuarter:Q3_2026_INDEX,skippedSellCount:1});
    expect(hold.nextState.sigConfirmedAnchor).toBe("8000");
  });

  it("30 Down: a close at 71 (just above 70% of 100) does not skip the sell",()=>{
    const closes=[...Array(8).fill("100"),"71"];
    const sell=run(ctx(key,{closes,exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([sell.actionType,amount(sell)]).toEqual(["SELL","1460.00"]);
  });

  it("30 Down: after the two skips are used and the price is still down, normal selling resumes",()=>{
    const closes=[...Array(8).fill("100"),"60"];
    const sell=run(ctx(key,{closes,exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",
        sigProtection:{startQuarter:Q3_2026_INDEX-2,skippedSellCount:2}}}));
    expect([sell.actionType,amount(sell)]).toEqual(["SELL","1460.00"]);
  });

  it("daily-close spike: quarter-end close 40, latest daily close 80 (2x), plan 12000 + 3000 = 15000 resets to 60% = 9000: sell 3000",()=>{
    const closes=[...Array(8).fill("30"),"40"];
    const c=ctx(key,{closes,now:"2026-10-20T15:00:00Z",reviewDue:false,exposures:[stockOf(key,"12000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"}});
    c.trustedHistory![0].points.push({at:new Date("2026-10-19T00:00:00Z"),adjustedClose:D("80")});
    const sell=run(c);
    expect([sell.actionType,amount(sell),sell.economicExposure]).toEqual(["SELL","3000.00","NASDAQ_100_3X_LONG"]);
    // After the fills the plan is 9000 / 6000; the review closes once per quarter without
    // completing the next quarter-end review.
    let state=postActionReviewState(sell,c.state,new Date("2026-10-20T15:00:00Z"));
    const after=ctx(key,{closes,now:"2026-10-20T16:00:00Z",reviewDue:true,exposures:[stockOf(key,"9000"),bondOf("6000")],cash:D(0),state});
    after.trustedHistory![0].points.push({at:new Date("2026-10-19T00:00:00Z"),adjustedClose:D("80")});
    const close=run(after);
    expect(close.actionType).toBe("HOLD");
    expect(close.nextState.sigConfirmedAnchor).toBe("9000");
    expect(close.nextState.sigSpikeResetReference).toBe("2026-09-30");
    expect(close.nextState.sigLastReviewedReference).toBe("2026-09-30");
    state=postActionReviewState(close,state,new Date("2026-10-20T16:00:00Z"));
    const again=ctx(key,{closes,now:"2026-10-21T15:00:00Z",reviewDue:false,exposures:[stockOf(key,"9000"),bondOf("6000")],cash:D(0),state});
    again.trustedHistory![0].points.push({at:new Date("2026-10-20T00:00:00Z"),adjustedClose:D("81")});
    expect(run(again).actionType).toBe("NO_ACTION");
  });

  it("daily-close spike: 79.99 is below 2 x 40, and an open 30 Down window blocks the reset",()=>{
    const closes=[...Array(8).fill("30"),"40"];
    const below=ctx(key,{closes,now:"2026-10-20T15:00:00Z",reviewDue:false,exposures:[stockOf(key,"12000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30"}});
    below.trustedHistory![0].points.push({at:new Date("2026-10-19T00:00:00Z"),adjustedClose:D("79.99")});
    expect(run(below).actionType).toBe("NO_ACTION");
    const protectedPlan=ctx(key,{closes,now:"2026-10-20T15:00:00Z",reviewDue:false,exposures:[stockOf(key,"12000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-09-30",sigProtection:{startQuarter:Q3_2026_INDEX,skippedSellCount:1}}});
    protectedPlan.trustedHistory![0].points.push({at:new Date("2026-10-19T00:00:00Z"),adjustedClose:D("80")});
    expect(run(protectedPlan).actionType).toBe("NO_ACTION");
  });

  it("withdrawals lower the line by half: 6000 x 1.09 - 0.5 x 1000 = 6040; stock 6000, no cash: release 40 of bonds",()=>{
    const step=run(ctx(key,{exposures:[stockOf(key,"6000"),bondOf("4000")],cash:D(0),withdrawalsSinceReview:D(1000),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([step.actionType,amount(step),step.economicExposure]).toEqual(["SELL","40.00","US_AGGREGATE_BONDS"]);
    expect(step.nextState.targetValue).toBe("6040");
  });

  it("act window: 3 trading days after the quarter end act; the 4th skips the quarter and carries the new cash",()=>{
    const state={sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"};
    const held=[stockOf(key,"6000"),bondOf("4000")];
    // Thu 2026-10-01, Fri 10-02, Mon 10-05 are trading days 1-3 after Wed 2026-09-30.
    const third=run(ctx(key,{now:"2026-10-05T15:00:00Z",exposures:held,cash:D(0),state}));
    expect(third.actionType).toBe("SELL");
    const fourth=run(ctx(key,{now:"2026-10-06T15:00:00Z",exposures:held,cash:D(1000),contributionsSinceReview:D(1000),state}));
    expect(fourth.actionType).toBe("HOLD");
    expect(fourth.nextState.sigConfirmedAnchor).toBe("6000");
    expect(fourth.nextState.sigCarriedNewCash).toBe("1000");
  });

  it("no review before the quarter-end close: on 2026-09-30 at 15:00 New York time nothing is due",()=>{
    const early=run(ctx(key,{now:"2026-09-30T19:00:00Z",exposures:[stockOf(key,"8000"),bondOf("3000")],
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    // The latest completed reference is then 2026-06-30, which is already reviewed.
    expect(early.actionType).toBe("NO_ACTION");
  });
});

describe("quarterly-target-midcap-2x golden cases",()=>{
  const key:Key="quarterly-target-midcap-2x";
  it("6% line: 6000 x 1.06 = 6360, stock 8000, sell 1640",()=>{
    const sell=run(ctx(key,{exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([sell.actionType,amount(sell),sell.economicExposure]).toEqual(["SELL","1640.00","US_MID_CAP_2X_LONG"]);
  });
  it("skips two sells after a 30 Down trigger, then resumes normal selling",()=>{
    const first=run(ctx(key,{closes:[...Array(8).fill("100"),"70"],exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect(first.actionType).toBe("HOLD");
    expect(first.nextState.sigProtection).toEqual({startQuarter:Q3_2026_INDEX,skippedSellCount:1});
    const second=run(ctx(key,{closes:[...Array(8).fill("100"),"65"],exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",sigProtection:{startQuarter:Q3_2026_INDEX-1,skippedSellCount:1}}}));
    expect(second.actionType).toBe("HOLD");
    expect(second.nextState.sigProtection).toEqual({startQuarter:Q3_2026_INDEX-1,skippedSellCount:2});
    // Both skips used and the price is still down: 6000 x 1.06 = 6360, sell 8000 - 6360 = 1640.
    const third=run(ctx(key,{closes:[...Array(8).fill("100"),"60"],exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",sigProtection:{startQuarter:Q3_2026_INDEX-2,skippedSellCount:2}}}));
    expect([third.actionType,amount(third)]).toEqual(["SELL","1640.00"]);
  });
});

describe("quarterly-target-smallcap golden cases",()=>{
  const key:Key="quarterly-target-smallcap";
  it("quarter-end spike reset: close 40 -> 80 (+100%), ordinary target 8000 x 1.03 = 8240 leaves 8240/10000 = 82.4% (inside 60-100%), so reset to 60% = 6000: sell 3000",()=>{
    const closes=[...Array(8).fill("40"),"80"];
    const sell=run(ctx(key,{closes,exposures:[stockOf(key,"9000"),bondOf("1000")],cash:D(0),
      state:{sigConfirmedAnchor:"8000",sigLastReviewedReference:"2026-06-30"}}));
    expect([sell.actionType,amount(sell)]).toEqual(["SELL","3000.00"]);
  });

  it("3% line: 6000 x 1.03 = 6180, stock 8000, sell 1820",()=>{
    const sell=run(ctx(key,{exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    expect([sell.actionType,amount(sell),sell.economicExposure]).toEqual(["SELL","1820.00","US_SMALL_CAP_BLEND"]);
  });
  it("buy: stock 5000 -> target 6180, gap 1180, cash 1180 on hand: buy 1180 directly",()=>{
    const buy=run(ctx(key,{exposures:[stockOf(key,"5000"),bondOf("3000")],cash:D(1180),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30"}}));
    // opening reserve 3000 + 1180 = 4180 -> budget 3762 >= 1180.
    expect([buy.actionType,amount(buy),buy.economicExposure]).toEqual(["BUY","1180.00","US_SMALL_CAP_BLEND"]);
  });
  it("skips up to four sells after a 30 Down trigger: the fourth skip is counted",()=>{
    const closes=[...Array(8).fill("100"),"65"];
    const hold=run(ctx(key,{closes,exposures:[stockOf(key,"8000"),bondOf("3000")],cash:D(0),
      state:{sigConfirmedAnchor:"6000",sigLastReviewedReference:"2026-06-30",
        sigProtection:{startQuarter:Q3_2026_INDEX-3,skippedSellCount:3}}}));
    expect(hold.actionType).toBe("HOLD");
    expect(hold.nextState.sigProtection).toEqual({startQuarter:Q3_2026_INDEX-3,skippedSellCount:4});
  });
});
