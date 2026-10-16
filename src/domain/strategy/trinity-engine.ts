import Decimal from "decimal.js";
import {fixedAllocationEngine} from "./fixed-allocation";
import {nextCalendarMonthDueAt,localDateInZone} from "../schedule";
import {trinityNyseHolidayWindow} from "./trinity-calendar";
import {trinityGlobalTrendSignal} from "./trinity-signals";
import {TRINITY_CONFIG,TRINITY_BILLS,TRINITY_US_SIGNAL,TRINITY_VALUE,TRINITY_MOMENTUM,
  TRINITY_STATIC,TRINITY_TRADE_UNIVERSE} from "./trinity-model";
import type {EngineContext,StrategyEngine,ProposedAction,TrustedHistoricalSeries} from "./types";

const err=(ctx:EngineContext,reason:string):ProposedAction=>({
  actionType:"DATA_REQUIRED",title:"Trinity trend signal unavailable",
  instruction:reason,explanation:[{label:"Signal",value:"Missing or invalid"}],
  nextState:ctx.state,confidence:"LOW",dueAt:ctx.now
});
function canonical(v:unknown):unknown{
  if(Array.isArray(v))return v.map(canonical);
  if(v&&typeof v==="object")return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));
  return v;
}
function same(a:unknown,b:unknown):boolean{return JSON.stringify(canonical(a))===JSON.stringify(canonical(b));}
export function validateTrinityConfig(raw:Record<string,unknown>){
  if(!same(raw,TRINITY_CONFIG))throw new Error("TRINITY_CONFIG_NOT_CANONICAL");
}
/** Find the most recently completed US month-end cutoff; never drift into a partial current month. */
export function trinitySignalCutoff(now:Date):Date{
  if(!Number.isFinite(now.getTime()))throw new Error("TRINITY_INVALID_REVIEW_DATE");
  let cursor=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-2,15,12));
  let last:Date|null=null;
  for(let i=0;i<5;i++){
    const next=nextCalendarMonthDueAt({lastReviewAt:cursor,timeZone:"America/New_York",cutoffLocal:"16:00",
      holidays:trinityNyseHolidayWindow(now)});
    if(next>now)break;
    last=next;cursor=new Date(next.getTime()+1000);
  }
  if(!last||now.getTime()-last.getTime()>35*86400_000)throw new Error("TRINITY_SIGNAL_CUTOFF_UNAVAILABLE");
  return last;
}
/** Convert independently verified daily adjusted closes to one last-observation-per-month series.
 * The engine checks the most recent month-end and all 12 preceding months; never fills a missing
 * month with a forward price. The final observation must belong to the most recent completed
 * review-month, which must be within seven calendar days of actual calculation.
 */
export function trinityMonthlySeries(daily:readonly TrustedHistoricalSeries[],asOf:Date):TrustedHistoricalSeries[]{
  if(daily.length!==10||!Number.isFinite(asOf.getTime()))throw new Error("TRINITY_DAILY_UNIVERSE_INCOMPLETE");
  const cutoffDate=localDateInZone(asOf,"America/New_York");
  return daily.map(s=>{
    if(!s.source||!s.currency||!s.exposure)throw new Error("TRINITY_DAILY_SOURCE_MISSING");
    const buckets=new Map<string,{at:Date;adjustedClose:Decimal}>();
    for(const p of s.points){
      if(!Number.isFinite(p.at.getTime())||!p.adjustedClose.isFinite()||p.adjustedClose.lte(0))
        throw new Error("TRINITY_DAILY_PRICE_INVALID");
      // Data later than the *completed* review cutoff can be valid as of calculation
      // time; never use those rows in the earlier month-end signal.
      if(p.at>asOf)continue;
      const id=p.at.getUTCFullYear()+"-"+String(p.at.getUTCMonth()+1).padStart(2,"0");
      const prior=buckets.get(id);
      if(!prior||prior.at<p.at)buckets.set(id,p);
    }
    const points=[...buckets.values()].sort((a,b)=>a.at.getTime()-b.at.getTime()).slice(-13);
    if(points.length!==13)throw new Error("TRINITY_MONTHLY_HISTORY_INCOMPLETE");
    if(points[points.length-1].at.toISOString().slice(0,10)!==cutoffDate)
      throw new Error("TRINITY_VERIFIED_MONTH_END_MISSING");
    return {...s,points};
  });
}
/** Combined 50% buy-and-hold + 50% tactical targeted exposures. */
export function trinityWeights(ctx:Pick<EngineContext,"trustedHistory"|"now">){
  if(!ctx.trustedHistory)throw new Error("TRINITY_HISTORY_REQUIRED");
  const cutoff=trinitySignalCutoff(ctx.now);
  const signalSeries=trinityMonthlySeries(ctx.trustedHistory,cutoff);
  const scored=trinityGlobalTrendSignal(signalSeries,cutoff);
  const result=new Map<string,Decimal>(TRINITY_TRADE_UNIVERSE.map(exposure=>[exposure,new Decimal(0)]));
  for(const row of TRINITY_STATIC)result.set(row.exposure,new Decimal(row.weight));
  for(const row of scored.riskWeights){
    if(row.exposure===TRINITY_US_SIGNAL){
      for(const exposure of [TRINITY_VALUE,TRINITY_MOMENTUM])
        result.set(exposure,result.get(exposure)!.plus("0.05"));
    }else{
      const before=result.get(row.exposure);
      if(!before)throw new Error("TRINITY_SIGNAL_NOT_TRADABLE:"+row.exposure);
      result.set(row.exposure,before.plus("0.10"));
    }
  }
  result.set(TRINITY_BILLS,new Decimal(scored.defensiveWeight).mul("0.50"));
  const total=[...result.values()].reduce((s,v)=>s.plus(v),new Decimal(0));
  if(!total.eq(1))throw new Error("TRINITY_WEIGHTS_NOT_BALANCED");
  return [...result].map(([exposure,weight])=>({exposure,weight:weight.toFixed(6)}));
}
export const trinityEngine:StrategyEngine={
  key:"TRINITY_HYBRID",
  validateConfig:validateTrinityConfig,
  calculate(ctx){
    validateTrinityConfig(ctx.config);
    if(ctx.dataHealth.status!=="CURRENT")return err(ctx,ctx.dataHealth.message??"Verified price data are not current.");
    if(!ctx.reviewDue)return {actionType:"NO_ACTION",title:"Next Trinity review is not due",
      instruction:"Global Trend signals are evaluated at month-end.",explanation:[],nextState:ctx.state,
      confidence:"HIGH",dueAt:ctx.nextReviewAt};
    let allocations:ReturnType<typeof trinityWeights>;
    try {allocations=trinityWeights(ctx);} catch(e){return err(ctx,e instanceof Error?e.message:"Incomplete signal data.");}
    // Keep zero-weight sleeves in the rows: a previously selected risk asset must
    // be sold even when it drops out of the five winners or fails trend.
    const response=fixedAllocationEngine.calculate({...ctx,config:{
      allocations,reviewFrequency:"MONTHLY",rebalanceThreshold:"0.00"
    }});
    return {...response,explanation:[{label:"Trinity edition",value:"Tactfolio 2016 proxy (50% global buy-and-hold / 50% Global Trend)"},...response.explanation]};
  }
};
