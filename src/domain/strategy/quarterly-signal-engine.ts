import Decimal from "decimal.js";
import type {EngineContext,ExplanationRow,ProposedAction,StrategyEngine} from "./types";
import {assess2026Community9Sig30Down,historical9SigSpikeReset,type Community9SigProtection} from "./9sig-community-rules";
import {verifiedSigQuarterCloses} from "./sig-quarter-closes";
import {latestSigReference,referenceHistoryDates} from "./sig-nyse-quarters";

/**
 * Quarterly signal strategy family (Wealtharr owner-selected variants of the published "Sig" method):
 * a growth-target line for ONE risk exposure, funded from a SAFE exposure (a bond fund), with a
 * quarterly act window, a purchase throttle, a "30 Down" sell-skip protection and a spike reset.
 *
 * Every number comes from the version's config; each rule is documented, with its source or its
 * "owner decision" label, in docs/strategy-specs/quarterly-target-*.md.
 *
 * One recalculation proposes ONE single-leg trade. A purchase that has to be funded by the safe sleeve is
 * therefore sequenced across recalculations: sell the safe exposure, then buy the risk exposure.
 */
export const QUARTERLY_SIGNAL_RULE_VERSION="WEALTHARR_OWNER_2026_V1";
export const QUARTERLY_SIGNAL_VARIANTS=["SIG_9","SIG_6","SIG_3"] as const;

type Params={
  stock:string;safe:string;growth:Decimal;initialRatio:Decimal;contributionRatio:Decimal;budgetRatio:Decimal;
  triggerRatio:Decimal;skipCap:number;spikeEnabled:boolean;spikeMultiple:Decimal;spikeRatio:Decimal;
  currency:string;window:number;leverage?:string;
};
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
  const window=Number(c.actWindowTradingDays);
  if(!Number.isInteger(window)||window<1||window>10)throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:actWindowTradingDays");
  const currency=String(c.referenceCurrency??"").trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(currency))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:referenceCurrency");
  const growth=ratio(c.quarterlyGrowth,"quarterlyGrowth",0,1);
  if(growth.lte(0))throw new Error("INVALID_QUARTERLY_SIGNAL_CONFIG:quarterlyGrowth");
  return {
    stock,safe,growth,
    initialRatio:ratio(c.initialTargetRatio,"initialTargetRatio"),
    contributionRatio:ratio(c.contributionTargetRatio,"contributionTargetRatio"),
    budgetRatio:ratio(c.buyBudgetRatio,"buyBudgetRatio"),
    triggerRatio:ratio(p.triggerRatio,"triggerRatio"),skipCap,
    spikeEnabled:s.enabled,
    spikeMultiple:s.enabled?ratio(s.gainMultiple,"gainMultiple",1,100):new Decimal(2),
    spikeRatio:s.enabled?ratio(s.targetRatio,"spikeTargetRatio"):new Decimal("0.60"),
    currency,window,leverage:String(c.targetLeverage??"").trim()||undefined
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
function stripReview(state:Record<string,unknown>){
  const out={...state};
  for(const k of Object.keys(out))if(k.startsWith("sigReview"))delete out[k];
  delete out.targetValue;
  return out;
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
    const fail=(instruction:string,title="Quarterly review needs attention"):ProposedAction=>({
      actionType:"DATA_REQUIRED",title,instruction,explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now
    });
    if(ctx.dataHealth.status!=="CURRENT")
      return fail(ctx.dataHealth.message??"Current verified market values are required before this review.","Data needs attention");
    const inReview=typeof ctx.state.reviewTargetValue==="string";
    if(!ctx.reviewDue&&!inReview)
      return {actionType:"NO_ACTION",title:"Everything is on track",instruction:"No quarterly review is due yet.",
        explanation:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt};

    if(ctx.exposures.some(x=>x.economicExposure!==p.stock&&x.economicExposure!==p.safe&&!x.value.isZero()))
      return fail("This strategy holds something outside its two managed exposures. Move it out of this strategy or reconcile the account before we calculate a trade.","A holding needs classification");
    const sum=(key:string)=>ctx.exposures.filter(x=>x.economicExposure===key).reduce((a,x)=>a.plus(x.value),ZERO);
    const stock=sum(p.stock),bond=sum(p.safe),cash=ctx.cash;
    if(stock.lt(0)||bond.lt(0)||cash.lt(0)||!stock.isFinite()||!bond.isFinite()||!cash.isFinite())
      return fail("Balances are invalid. Reconcile the strategy before trading.");
    const total=stock.plus(bond).plus(cash);

    let ref;
    try{ref=latestSigReference(ctx.now);}catch{return fail("The quarter-end reference date could not be determined.");}
    let protection:Community9SigProtection;
    try{protection=readProtection(ctx.state.sigProtection);}catch{return fail("The saved 30 Down state is invalid. Reconcile before trading.");}
    const stateRef=typeof ctx.state.sigReviewReference==="string"?ctx.state.sigReviewReference:null;
    const lastReviewed=typeof ctx.state.sigLastReviewedReference==="string"?ctx.state.sigLastReviewedReference:null;
    const carried=new Decimal(String(ctx.state.sigCarriedNewCash??"0"));
    if(!carried.isFinite()||carried.lt(0))return fail("The saved carried-cash value is invalid. Reconcile before trading.");
    const contrib=ctx.contributionsSinceReview;
    if(!contrib.isFinite()||contrib.lt(0))return fail("The contribution ledger needs reconciliation before trading.");

    const closed=(anchor:Decimal,prot:Community9SigProtection,refDate:string|null,carry:Decimal,title:string,instruction:string,
      explanation:ExplanationRow[]):ProposedAction=>({
      actionType:"HOLD",title,instruction,explanation,confidence:"HIGH",dueAt:ctx.now,
      nextState:{...stripReview(ctx.state),sigConfirmedAnchor:anchor.toString(),sigProtection:prot,
        ...(refDate?{sigLastReviewedReference:refDate}:{}),sigCarriedNewCash:carry.toString()}
    });

    const anchorRaw=ctx.state.sigConfirmedAnchor;
    const kind:"INITIAL"|"SIGNAL"=inReview?(ctx.state.sigReviewKind==="INITIAL"?"INITIAL":"SIGNAL")
      :(anchorRaw==null?"INITIAL":"SIGNAL");
    let anchor=ZERO;
    if(kind==="SIGNAL"){
      if(typeof anchorRaw!=="string")return fail("The confirmed starting point of this strategy is missing. Reconcile before trading.");
      anchor=new Decimal(anchorRaw);
      if(!anchor.isFinite()||anchor.lt(0))return fail("The confirmed starting point of this strategy is invalid.");
    }

    // Window handling (signal reviews only).
    let reviewRef=ref.referenceDate;
    if(kind==="SIGNAL"){
      if(inReview){
        if(stateRef&&stateRef!==ref.referenceDate)
          return closed(stock,protection,stateRef,ZERO,"Earlier review closed",
            "A review from an earlier quarter was never completed, so that quarter is skipped and the strategy starts fresh from its current holdings.",[]);
        reviewRef=stateRef??ref.referenceDate;
      }else{
        if(lastReviewed&&ref.referenceDate<=lastReviewed)
          return {actionType:"NO_ACTION",title:"Everything is on track",instruction:"The latest quarterly review is already complete.",
            explanation:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt};
        if(ref.tradingDaysSince>p.window)
          return closed(stock,protection,ref.referenceDate,carried.plus(contrib),"Review window missed",
            `The ${p.window}-trading-day window after the quarter end has passed, so this quarter is skipped with no trade. The next review applies a single growth step.`,
            [{label:"Quarter end",value:ref.referenceDate,kind:"text"}]);
      }
    }

    // Target.
    const snapshot=ctx.state.reviewContributionsSnapshot==null?contrib:new Decimal(String(ctx.state.reviewContributionsSnapshot));
    if(!snapshot.isFinite()||snapshot.lt(0))return fail("The saved contribution snapshot is invalid.");
    let target:Decimal;
    const lift=kind==="INITIAL"?ZERO:p.contributionRatio;
    if(inReview){
      const frozen=new Decimal(String(ctx.state.reviewTargetValue));
      if(!frozen.isFinite()||frozen.lt(0))return fail("The saved review target is invalid.");
      target=frozen.plus(contrib.minus(snapshot).mul(lift));
    }else if(kind==="INITIAL"){
      target=total.mul(p.initialRatio);
    }else{
      target=anchor.mul(new Decimal(1).plus(p.growth)).plus(contrib.plus(carried).mul(p.contributionRatio));
    }
    if(target.lt(0))target=ZERO;

    // 30 Down and spike reset (signal reviews only).
    let decisionProtection=protection;
    let protectionActive=false;
    let skippedBySignal=false;
    let spiked=false;
    const rows:ExplanationRow[]=[];
    if(kind==="SIGNAL"){
      let closes:Decimal[];
      try{
        const series=ctx.trustedHistory?.find(s=>s.exposure===p.stock&&s.currency.toUpperCase()===p.currency);
        closes=verifiedSigQuarterCloses(series,referenceHistoryDates(ref.quarterIndex),p.currency);
      }catch{return fail("Verified quarter-end closes for the risk exposure are required for this review.","Verified history needed");}
      const signalOf=(t:Decimal)=>{const g=t.minus(stock);return g.abs().lt(TOL)?"HOLD" as const:g.gt(0)?"BUY" as const:"SELL" as const;};
      let decision;
      try{
        decision=assess2026Community9Sig30Down({quarterIndex:ref.quarterIndex,currentTqqqClose:closes[8],
          precedingEightTqqqQuarterCloses:closes.slice(0,8),signal:signalOf(target),protection,
          triggerRatio:p.triggerRatio,skipCap:p.skipCap});
      }catch{return fail("The 30 Down state cannot be verified. Reconcile before trading.");}
      decisionProtection=decision.protection;
      protectionActive=decision.protectionActive;
      skippedBySignal=decision.signal==="SELL"&&decision.effectiveSignal==="HOLD";
      if(!inReview&&p.spikeEnabled&&!protectionActive&&total.gt(0)){
        const ordinaryStock=Decimal.min(target,total);
        const reset=historical9SigSpikeReset({previousQuarterClose:closes[7],currentQuarterClose:closes[8],
          afterOrdinaryRebalanceStockValue:ordinaryStock,afterOrdinaryRebalanceBondValue:total.minus(ordinaryStock),
          in30DownNoSellPeriod:false});
        if(reset.eligible&&closes[8].gte(closes[7].mul(p.spikeMultiple))){target=total.mul(p.spikeRatio);spiked=true;}
      }
      if(protectionActive)rows.push({label:"30 Down protection",value:skippedBySignal?"Sell skipped":"Active",kind:"text"});
      if(spiked)rows.push({label:"Spike reset",value:"Target reset",kind:"text"});
    }

    const gap=target.minus(stock);
    rows.unshift({label:"Target value",value:money(target),kind:"money"},{label:"Current value",value:money(stock),kind:"money"},
      {label:"Gap",value:money(gap),kind:"money"});
    const nextStateBase={...ctx.state,reviewContributionsSnapshot:contrib.toString(),targetValue:target.toString(),
      sigReviewKind:kind,sigReviewReference:reviewRef,lastCalculatedAt:ctx.now.toISOString()};
    const closeState=closed(stock,decisionProtection,kind==="INITIAL"?ref.referenceDate:reviewRef,ZERO,"","",[]).nextState;
    const done=(title:string,instruction:string)=>closed(stock,decisionProtection,kind==="INITIAL"?ref.referenceDate:reviewRef,ZERO,title,instruction,rows);

    if(skippedBySignal&&gap.lt(0))
      return done("Sell skipped by 30 Down","The 30 Down protection is active, so the sell signal for this quarter is skipped. No trade is needed.");

    // Purchase budget: a share of the reserve (safe sleeve + cash) at the start of the review.
    let budget=new Decimal(Infinity);
    if(kind==="SIGNAL"){
      const t=ctx.sigReviewTrades;
      if(!t)return fail("Confirmed trades of this review are required before sizing a purchase.");
      const opening=bond.plus(cash).minus(t.stockSellGross).plus(t.stockBuyGross).plus(t.feeTotal);
      if(!opening.isFinite()||opening.lt(0))return fail("The review's opening reserve cannot be reconciled with the ledger.");
      budget=Decimal.max(ZERO,opening.mul(p.budgetRatio).minus(t.stockBuyGross));
      rows.push({label:"Purchase budget left",value:money(budget),kind:"money"});
    }
    const safeSold=ctx.sigReviewTrades?.safeSellGross??ZERO;
    const stockAction=(side:"BUY"|"SELL",amount:Decimal,title:string):ProposedAction=>({
      actionType:side,title,instruction:`Under the strategy rules, ${side==="BUY"?"add":"reduce"} ${money(amount)} ${p.currency} of ${p.stock} exposure.`,
      amount,currency:p.currency,economicExposure:p.stock,leverage:p.leverage,explanation:rows,nextState:nextStateBase,
      confidence:"HIGH",dueAt:ctx.now,residueCloseState:closeState
    });
    const safeAction=(side:"BUY"|"SELL",amount:Decimal,title:string,sweep:boolean):ProposedAction=>({
      actionType:side,title,instruction:`Under the strategy rules, ${side==="BUY"?"move":"release"} ${money(amount)} ${p.currency} ${side==="BUY"?"into":"from"} ${p.safe} exposure.`,
      amount,currency:p.currency,economicExposure:p.safe,explanation:rows,nextState:nextStateBase,
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
