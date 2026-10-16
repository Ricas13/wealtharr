import Decimal from "decimal.js";
import type {EngineContext,ExplanationRow,ProposedAction,StrategyEngine} from "./types";
import {assess2026Community9Sig30Down,historical9SigSpikeReset,type Community9SigProtection} from "./9sig-community-rules";
import {assessWealtharr9SigDailySpike} from "./sig-owner-conventions";
import {verifiedSigQuarterCloses} from "./sig-quarter-closes";
import {isNyseTradingDay,latestSigReference,newYorkDate,newYorkMinutes,NYSE_CLOSE_MINUTES,referenceHistoryDates,type SigReference} from "./sig-nyse-quarters";

/**
 * Quarterly signal strategy family (Wealtharr owner-selected variants of the published "Sig" method):
 * a growth-target line for ONE risk exposure, funded from a SAFE exposure (a bond fund), with a
 * quarterly act window, a purchase throttle, a "30 Down" sell-skip protection and a spike reset.
 *
 * Every number comes from the version's config; each rule is documented, with its source or its
 * "owner decision" label, in docs/strategy-specs/quarterly-target-*.md. Rules added in a later version
 * (withdrawals lowering the line, the daily-close spike) are read from config keys that the earlier
 * immutable versions do not carry, so those versions keep their published behaviour.
 *
 * Money amounts are in the strategy account's currency (`ctx.baseCurrency`). The reference currency in
 * the config is only the currency of the risk exposure's price history used for the signals.
 *
 * One recalculation proposes ONE single-leg trade. A purchase that has to be funded by the safe sleeve is
 * therefore sequenced across recalculations: sell the safe exposure, then buy the risk exposure.
 */
export const QUARTERLY_SIGNAL_RULE_VERSION="WEALTHARR_OWNER_2026_V1";
export const QUARTERLY_SIGNAL_VARIANTS=["SIG_9","SIG_6","SIG_3"] as const;

type Params={
  stock:string;safe:string;growth:Decimal;initialRatio:Decimal;contributionRatio:Decimal;budgetRatio:Decimal;
  withdrawalRatio:Decimal;triggerRatio:Decimal;skipCap:number;spikeEnabled:boolean;spikeDaily:boolean;
  spikeMultiple:Decimal;spikeRatio:Decimal;referenceCurrency:string;window:number;leverage?:string;
};
type ReviewKind="INITIAL"|"SIGNAL"|"SPIKE";
const ZERO=new Decimal(0);
const TOL=new Decimal("0.01");
const dec=(v:unknown,label:string)=>{
  const d=new Decimal(String(v));
  if(!d.isFinite())throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:"+label);
  return d;
};
const ratio=(v:unknown,label:string,min=0,max=1)=>{
  const d=dec(v,label);
  if(d.lt(min)||d.gt(max))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:"+label);
  return d;
};
function parse(c:Record<string,unknown>):Params{
  if(c.ruleVersion!==QUARTERLY_SIGNAL_RULE_VERSION)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:ruleVersion");
  if(!(QUARTERLY_SIGNAL_VARIANTS as readonly unknown[]).includes(c.variant))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:variant");
  const stock=String(c.targetExposure??"").trim(),safe=String(c.safeExposure??"").trim();
  if(!stock||!safe||stock===safe)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:exposures");
  const p=(c.protection??{}) as Record<string,unknown>;
  if(Number(p.lookbackQuarters)!==8)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:lookbackQuarters");
  const skipCap=Number(p.skippedSells);
  if(!Number.isInteger(skipCap)||skipCap<1||skipCap>8)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:skippedSells");
  const s=(c.spikeReset??{}) as Record<string,unknown>;
  if(typeof s.enabled!=="boolean")throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:spikeReset");
  // Absent in version 1.0 (quarter-end check with the 2018 allocation band).
  const observation=s.observation??"QUARTER_END";
  if(observation!=="QUARTER_END"&&observation!=="DAILY_CLOSE")throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:spikeObservation");
  const window=Number(c.actWindowTradingDays);
  if(!Number.isInteger(window)||window<1||window>10)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:actWindowTradingDays");
  const referenceCurrency=String(c.referenceCurrency??"").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(referenceCurrency))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:referenceCurrency");
  const growth=ratio(c.quarterlyGrowth,"quarterlyGrowth",0,1);
  if(growth.lte(0))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:quarterlyGrowth");
  return {
    stock,safe,growth,
    initialRatio:ratio(c.initialTargetRatio,"initialTargetRatio"),
    contributionRatio:ratio(c.contributionTargetRatio,"contributionTargetRatio"),
    budgetRatio:ratio(c.buyBudgetRatio,"buyBudgetRatio"),
    // Absent in version 1.0: withdrawals then leave the line unchanged.
    withdrawalRatio:c.withdrawalTargetRatio==null?ZERO:ratio(c.withdrawalTargetRatio,"withdrawalTargetRatio"),
    triggerRatio:ratio(p.triggerRatio,"triggerRatio"),skipCap,
    spikeEnabled:s.enabled,spikeDaily:s.enabled&&observation==="DAILY_CLOSE",
    spikeMultiple:s.enabled?ratio(s.gainMultiple,"gainMultiple",1,100):new Decimal(2),
    spikeRatio:s.enabled?ratio(s.targetRatio,"spikeTargetRatio"):new Decimal("0.60"),
    referenceCurrency,window,leverage:String(c.targetLeverage??"").trim()||undefined
  };
}
const money=(d:Decimal)=>d.toDecimalPlaces(2,Decimal.ROUND_HALF_EVEN).toFixed(2);
const noProtection=():Community9SigProtection=>({startQuarter:null,skippedSellCount:0});
function readProtection(v:unknown):Community9SigProtection{
  if(v==null)return noProtection();
  const o=v as Record<string,unknown>;
  if(typeof v!=="object"||!("startQuarter" in o)||!("skippedSellCount" in o)||
    (o.startQuarter!==null&&!Number.isInteger(o.startQuarter))||!Number.isInteger(o.skippedSellCount))
    throw new Error("INVALID_QUARTERLY_SIGNAL_STATE");
  return {startQuarter:o.startQuarter as number|null,skippedSellCount:o.skippedSellCount as number};
}
/** A 30 Down no-sell window that is still open at the given quarter. */
function protectionWindowOpen(protection:Community9SigProtection,quarterIndex:number,skipCap:number){
  return protection.startQuarter!==null&&quarterIndex-protection.startQuarter<8&&protection.skippedSellCount<skipCap;
}
function stripReview(state:Record<string,unknown>){
  const out={...state};
  for(const k of Object.keys(out))if(k.startsWith("sigReview"))delete out[k];
  delete out.targetValue;
  return out;
}
function savedAmount(state:Record<string,unknown>,key:string){
  const value=new Decimal(String(state[key]??"0"));
  if(!value.isFinite()||value.lt(0))throw new Error("INVALID_QUARTERLY_SIGNAL_STATE");
  return value;
}

/**
 * Daily-close spike (version 1.1, owner convention of 2026-10-15): the latest verified daily close of the
 * risk exposure after the last quarter end is at least `gainMultiple` times that quarter-end close, and no
 * 30 Down no-sell window is open. Evaluated at most once per quarter.
 */
function dailySpikeTriggered(ctx:EngineContext,p:Params,ref:SigReference,protection:Community9SigProtection,
  stock:Decimal,bond:Decimal):boolean{
  const series=ctx.trustedHistory?.find(s=>s.exposure===p.stock&&s.currency.toUpperCase()===p.referenceCurrency);
  if(!series)throw new Error("SIG_DAILY_HISTORY_UNAVAILABLE");
  const day=(at:Date)=>at.toISOString().slice(0,10);
  const quarterEnd=series.points.find(point=>day(point.at)===ref.referenceDate);
  if(!quarterEnd)throw new Error("SIG_DAILY_HISTORY_UNAVAILABLE");
  const today=newYorkDate(ctx.now);
  // A daily row bearing today's NYSE session date is NOT a completed daily close before 16:00
  // New York time. Even an adjusted, licensed row must never trigger a live spike intraday.
  const lastCompletedDay=newYorkMinutes(ctx.now)>=NYSE_CLOSE_MINUTES?today:
    new Date(Date.parse(today+"T00:00:00Z")-86_400_000).toISOString().slice(0,10);
  // A weekend or full NYSE holiday cannot contain an exchange daily close, even if an upstream
  // source incorrectly stamped an adjusted price with that calendar date.
  const later=series.points.filter(point=>{
    const date=day(point.at);
    return date>ref.referenceDate&&date<=lastCompletedDay&&isNyseTradingDay(date);
  });
  if(!later.length)return false;
  const latest=later.reduce((a,b)=>day(b.at)>day(a.at)?b:a);
  const assessed=assessWealtharr9SigDailySpike({
    previousQuarterTqqqClose:quarterEnd.adjustedClose,observationTqqqClose:latest.adjustedClose,
    observationDate:day(latest.at),previousQuarterLastTradingDay:ref.referenceDate,verifiedDailyClose:true,
    in30DownProtection:protectionWindowOpen(protection,ref.quarterIndex,p.skipCap),
    stockValue:stock,bondValue:bond
  });
  return assessed.triggered&&latest.adjustedClose.gte(quarterEnd.adjustedClose.mul(p.spikeMultiple));
}

export const quarterlySignalEngine:StrategyEngine={
  key:"QUARTERLY_SIGNAL_TARGET",
  validateConfig(config){parse(config);},
  calculate(ctx:EngineContext):ProposedAction{
    parse(ctx.config); // an invalid immutable configuration is a programming/release error and throws
    try{return calculateReview(ctx);}
    catch{
      // Malformed saved state or ledger numbers never become a guessed trade.
      return {actionType:"DATA_REQUIRED",title:"Quarterly review needs attention",
        instruction:"Saved strategy state or ledger values could not be read. Reconcile the strategy before trading.",
        explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now};
    }
  }
};

function calculateReview(ctx:EngineContext):ProposedAction{
    const p=parse(ctx.config);
    const currency=ctx.baseCurrency;
    const fail=(instruction:string,title="Quarterly review needs attention"):ProposedAction=>({
      actionType:"DATA_REQUIRED",title,instruction,explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now
    });
    const notDue=(instruction:string):ProposedAction=>({actionType:"NO_ACTION",title:"Everything is on track",instruction,
      explanation:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt});
    if(ctx.dataHealth.status!=="CURRENT")
      return fail(ctx.dataHealth.message??"Current verified market values are required before this review.","Data needs attention");
    const inReview=typeof ctx.state.reviewTargetValue==="string";
    const anchorRaw=ctx.state.sigConfirmedAnchor;
    // Between reviews only a daily-close spike can start one, and only once a starting point exists.
    if(!ctx.reviewDue&&!inReview&&!(p.spikeDaily&&anchorRaw!=null))return notDue("No quarterly review is due yet.");

    if(ctx.exposures.some(x=>x.economicExposure!==p.stock&&x.economicExposure!==p.safe&&!x.value.isZero()))
      return fail("This strategy holds something outside its two managed exposures. Move it out of this strategy or reconcile the account before we calculate a trade.","A holding needs classification");
    const sum=(key:string)=>ctx.exposures.filter(x=>x.economicExposure===key).reduce((a,x)=>a.plus(x.value),ZERO);
    const stock=sum(p.stock),bond=sum(p.safe),cash=ctx.cash;
    if(stock.lt(0)||bond.lt(0)||cash.lt(0)||!stock.isFinite()||!bond.isFinite()||!cash.isFinite())
      return fail("Balances are invalid. Reconcile the strategy before trading.");
    const total=stock.plus(bond).plus(cash);

    let ref:SigReference;
    try{ref=latestSigReference(ctx.now);}catch{return fail("The quarter-end reference date could not be determined.");}
    let protection:Community9SigProtection;
    try{protection=readProtection(ctx.state.sigProtection);}catch{return fail("The saved 30 Down state is invalid. Reconcile before trading.");}
    const stateRef=typeof ctx.state.sigReviewReference==="string"?ctx.state.sigReviewReference:null;
    const lastReviewed=typeof ctx.state.sigLastReviewedReference==="string"?ctx.state.sigLastReviewedReference:null;
    let carried:Decimal,carriedWithdrawals:Decimal;
    try{carried=savedAmount(ctx.state,"sigCarriedNewCash");carriedWithdrawals=savedAmount(ctx.state,"sigCarriedWithdrawals");}
    catch{return fail("The saved carried-cash value is invalid. Reconcile before trading.");}
    const contrib=ctx.contributionsSinceReview;
    if(!contrib.isFinite()||contrib.lt(0))return fail("The contribution ledger needs reconciliation before trading.");
    const withdrawals=ctx.withdrawalsSinceReview??ZERO;
    if(!withdrawals.isFinite()||withdrawals.lt(0))return fail("The withdrawal ledger needs reconciliation before trading.");

    const closed=(anchor:Decimal,prot:Community9SigProtection,refDate:string|null,carry:Decimal,carryWithdrawals:Decimal,
      title:string,instruction:string,explanation:ExplanationRow[],extra:Record<string,unknown>={}):ProposedAction=>({
      actionType:"HOLD",title,instruction,explanation,confidence:"HIGH",dueAt:ctx.now,
      nextState:{...stripReview(ctx.state),sigConfirmedAnchor:anchor.toString(),sigProtection:prot,
        ...(refDate?{sigLastReviewedReference:refDate}:{}),sigCarriedNewCash:carry.toString(),
        sigCarriedWithdrawals:carryWithdrawals.toString(),...extra}
    });

    let kind:ReviewKind=inReview
      ?(ctx.state.sigReviewKind==="INITIAL"||ctx.state.sigReviewKind==="SPIKE"?ctx.state.sigReviewKind:"SIGNAL")
      :(anchorRaw==null?"INITIAL":"SIGNAL");
    let anchor=ZERO;
    if(kind!=="INITIAL"){
      if(typeof anchorRaw!=="string")return fail("The confirmed starting point of this strategy is missing. Reconcile before trading.");
      anchor=new Decimal(anchorRaw);
      if(!anchor.isFinite()||anchor.lt(0))return fail("The confirmed starting point of this strategy is invalid.");
    }

    // Which review is this? (Signal and spike reviews; the initial review needs no quarter.)
    let reviewRef=ref.referenceDate;
    if(kind!=="INITIAL"){
      if(inReview){
        if(stateRef&&stateRef!==ref.referenceDate)
          return closed(stock,protection,kind==="SIGNAL"?stateRef:null,carried,carriedWithdrawals,"Earlier review closed",
            "A review from an earlier quarter was never completed, so it is closed and the strategy starts fresh from its current holdings.",[]);
        reviewRef=stateRef??ref.referenceDate;
      }else{
        const quarterDue=ctx.reviewDue&&!(lastReviewed&&ref.referenceDate<=lastReviewed);
        if(!quarterDue){
          if(!p.spikeDaily||ctx.state.sigSpikeResetReference===ref.referenceDate)
            return notDue(ctx.reviewDue?"The latest quarterly review is already complete.":"No quarterly review is due yet.");
          let spike:boolean;
          try{spike=dailySpikeTriggered(ctx,p,ref,protection,stock,bond);}
          catch{return fail("Verified daily closes for the risk exposure are required to watch for a spike reset.","Verified history needed");}
          if(!spike)return notDue("No quarterly review is due yet, and no spike reset applies.");
          kind="SPIKE";
        }else if(ref.tradingDaysSince>p.window){
          return closed(stock,protection,ref.referenceDate,carried.plus(contrib),carriedWithdrawals.plus(withdrawals),"Review window missed",
            `The ${p.window}-trading-day window after the quarter end has passed, so this quarter is skipped with no trade. The next review applies a single growth step.`,
            [{label:"Quarter end",value:ref.referenceDate,kind:"text"}]);
        }
      }
    }

    // Target.
    const snapshot=ctx.state.reviewContributionsSnapshot==null?contrib:new Decimal(String(ctx.state.reviewContributionsSnapshot));
    const withdrawalSnapshot=ctx.state.sigReviewWithdrawalsSnapshot==null?withdrawals:new Decimal(String(ctx.state.sigReviewWithdrawalsSnapshot));
    if(!snapshot.isFinite()||snapshot.lt(0)||!withdrawalSnapshot.isFinite()||withdrawalSnapshot.lt(0))
      return fail("The saved contribution snapshot is invalid.");
    let target:Decimal;
    const lift=kind==="INITIAL"?ZERO:p.contributionRatio;
    const drop=kind==="INITIAL"?ZERO:p.withdrawalRatio;
    if(inReview){
      const frozen=new Decimal(String(ctx.state.reviewTargetValue));
      if(!frozen.isFinite()||frozen.lt(0))return fail("The saved review target is invalid.");
      target=frozen.plus(contrib.minus(snapshot).mul(lift)).minus(withdrawals.minus(withdrawalSnapshot).mul(drop));
    }else if(kind==="INITIAL"){
      target=total.mul(p.initialRatio);
    }else if(kind==="SPIKE"){
      target=total.mul(p.spikeRatio);
    }else{
      target=anchor.mul(new Decimal(1).plus(p.growth)).plus(contrib.plus(carried).mul(p.contributionRatio))
        .minus(withdrawals.plus(carriedWithdrawals).mul(p.withdrawalRatio));
    }
    if(target.lt(0))target=ZERO;

    // 30 Down and the quarter-end spike reset (signal reviews only).
    let decisionProtection=protection;
    let skippedBySignal=false;
    const rows:ExplanationRow[]=[];
    if(kind==="SIGNAL"){
      let closes:Decimal[];
      try{
        const series=ctx.trustedHistory?.find(s=>s.exposure===p.stock&&s.currency.toUpperCase()===p.referenceCurrency);
        closes=verifiedSigQuarterCloses(series,referenceHistoryDates(ref.quarterIndex),p.referenceCurrency);
      }catch{return fail("Verified quarter-end closes for the risk exposure are required for this review.","Verified history needed");}
      const signalOf=(t:Decimal)=>{const g=t.minus(stock);return g.abs().lt(TOL)?"HOLD" as const:g.gt(0)?"BUY" as const:"SELL" as const;};
      let decision;
      try{
        decision=assess2026Community9Sig30Down({quarterIndex:ref.quarterIndex,currentTqqqClose:closes[8],
          precedingEightTqqqQuarterCloses:closes.slice(0,8),signal:signalOf(target),protection,
          triggerRatio:p.triggerRatio,skipCap:p.skipCap});
      }catch{return fail("The 30 Down state cannot be verified. Reconcile before trading.");}
      decisionProtection=decision.protection;
      skippedBySignal=decision.signal==="SELL"&&decision.effectiveSignal==="HOLD";
      if(!inReview&&p.spikeEnabled&&!p.spikeDaily&&!decision.protectionActive&&total.gt(0)){
        const ordinaryStock=Decimal.min(target,total);
        const reset=historical9SigSpikeReset({previousQuarterClose:closes[7],currentQuarterClose:closes[8],
          afterOrdinaryRebalanceStockValue:ordinaryStock,afterOrdinaryRebalanceBondValue:total.minus(ordinaryStock),
          in30DownNoSellPeriod:false});
        if(reset.eligible&&closes[8].gte(closes[7].mul(p.spikeMultiple))){
          target=total.mul(p.spikeRatio);
          rows.push({label:"Spike reset",value:"Target reset",kind:"text"});
        }
      }
      if(decision.protectionActive)rows.push({label:"30 Down protection",value:skippedBySignal?"Sell skipped":"Active",kind:"text"});
    }
    if(kind==="SPIKE")rows.push({label:"Spike reset",value:"Daily close at least double the quarter-end close",kind:"text"});

    const gap=target.minus(stock);
    rows.unshift({label:"Target value",value:money(target),kind:"money"},{label:"Current value",value:money(stock),kind:"money"},
      {label:"Gap",value:money(gap),kind:"money"});
    const nextStateBase={...ctx.state,reviewContributionsSnapshot:contrib.toString(),sigReviewWithdrawalsSnapshot:withdrawals.toString(),
      targetValue:target.toString(),sigReviewKind:kind,sigReviewReference:reviewRef,lastCalculatedAt:ctx.now.toISOString()};
    // A spike reset does not complete the quarter's signal review; it is recorded once per quarter.
    const closeRef=kind==="SPIKE"?null:kind==="INITIAL"?ref.referenceDate:reviewRef;
    const closeExtra=kind==="SPIKE"?{sigSpikeResetReference:reviewRef}:{};
    const done=(title:string,instruction:string)=>
      closed(stock,decisionProtection,closeRef,ZERO,ZERO,title,instruction,rows,closeExtra);
    const closeState=done("","").nextState;

    if(skippedBySignal&&gap.lt(0))
      return done("Sell skipped by 30 Down","The 30 Down protection is active, so the sell signal for this quarter is skipped. No trade is needed.");

    // Purchase budget: a share of the reserve (safe sleeve + cash) at the start of a signal review.
    let budget=new Decimal(Infinity);
    let openingReserveSnapshot:Decimal|undefined;
    if(kind==="SIGNAL"){
      const t=ctx.sigReviewTrades;
      if(!t)return fail("Confirmed trades of this review are required before sizing a purchase.");
      // The 90% cap belongs to the reserve at the START of the review. Reconstructing it from
      // today's bond mark-to-market value and executed cash flows lets a bond-price move silently
      // change the cap between a funding sale and a stock purchase.
      const recorded=ctx.state.sigReviewOpeningReserve;
      let opening:Decimal;
      if(inReview&&recorded!=null){
        opening=new Decimal(String(recorded));
      }else if(inReview&&[t.stockBuyGross,t.stockSellGross,t.safeBuyGross,t.safeSellGross]
        .some(amount=>!amount.isZero())){
        // Older in-flight reviews have no immutable opening snapshot. Once there have been fills,
        // the original mark-to-market reserve cannot be recovered from the current quote.
        return fail("The review started before its opening reserve was recorded. Reconcile the original reserve before trading.","Opening reserve needs reconciliation");
      }else{
        // For a new review, any older activity is already in today's confirmed holdings and cash.
        // The caller has excluded the reserved cash buffer from ctx.cash.
        opening=bond.plus(cash);
      }
      if(!opening.isFinite()||opening.lt(0))return fail("The review's opening reserve is invalid.");
      budget=Decimal.max(ZERO,opening.mul(p.budgetRatio).minus(inReview?t.stockBuyGross:ZERO));
      openingReserveSnapshot=opening;
      rows.push({label:"Purchase budget left",value:money(budget),kind:"money"});
    }
    const safeSold=ctx.sigReviewTrades?.safeSellGross??ZERO;
    const stockAction=(side:"BUY"|"SELL",amount:Decimal,title:string):ProposedAction=>({
      actionType:side,title,instruction:`Under the strategy rules, ${side==="BUY"?"add":"reduce"} ${money(amount)} ${currency} of ${p.stock} exposure.`,
      amount,currency,economicExposure:p.stock,leverage:p.leverage,explanation:rows,nextState:openingReserveSnapshot?{...nextStateBase,sigReviewOpeningReserve:openingReserveSnapshot.toString()}:nextStateBase,
      confidence:"HIGH",dueAt:ctx.now,residueCloseState:closeState
    });
    const safeAction=(side:"BUY"|"SELL",amount:Decimal,title:string,sweep:boolean):ProposedAction=>({
      actionType:side,title,instruction:`Under the strategy rules, ${side==="BUY"?"move":"release"} ${money(amount)} ${currency} ${side==="BUY"?"into":"from"} ${p.safe} exposure.`,
      amount,currency,economicExposure:p.safe,explanation:rows,nextState:openingReserveSnapshot?{...nextStateBase,sigReviewOpeningReserve:openingReserveSnapshot.toString()}:nextStateBase,
      confidence:"HIGH",dueAt:ctx.now,residueCloseState:closeState,optionalSweep:sweep
    });

    if(gap.lte(TOL.neg())){
      const amount=Decimal.min(gap.neg(),stock);
      return stockAction("SELL",amount,"Sell "+money(amount)+" of the target exposure");
    }
    const x=gap.gte(TOL)?Decimal.min(gap,budget,bond.plus(cash)):ZERO;
    if(x.gte(TOL)){
      if(cash.gte(x.minus("0.005")))return stockAction("BUY",Decimal.min(x,cash),"Buy "+money(Decimal.min(x,cash))+" of the target exposure");
      if(safeSold.isZero()&&bond.gt(0)){
        const release=Decimal.min(bond,x.minus(cash));
        return safeAction("SELL",release,"Release "+money(release)+" from the safe sleeve",false);
      }
      if(cash.gte(TOL))return stockAction("BUY",cash,"Buy "+money(cash)+" of the target exposure");
      return done("Review complete","There is no cash or safe-sleeve balance left to fund more of the target exposure, so this review is complete.");
    }
    if(cash.gte(TOL))return safeAction("BUY",cash,"Move "+money(cash)+" into the safe sleeve",true);
    return done("Review complete","The strategy is at its target for this quarter. No further trade is needed.");
}
