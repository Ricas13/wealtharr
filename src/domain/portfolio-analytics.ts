import Decimal from "decimal.js";

/** A valuation is an end-of-day snapshot in the account currency. Never mix currencies. */
export type Valuation = { date: string; value: string };
export type DatedFlow = { date: string; amount: string };
export type StrategySeries = { id: string; name: string; currency: string; valuations: Valuation[]; flows: DatedFlow[] };
export type AnalyticsSummary = {
  startDate: string; endDate: string; observations: number; latestValue: string;
  netFlowSinceStart: string; profitSinceStart: string;
  flowAdjustedReturnPct: number | null;
  observedMaxDrawdownPct: number | null; currentDrawdownPct: number | null;
  bestObservedSessionPct: number | null; worstObservedSessionPct: number | null;
  lastObservedSessionPnl: string | null; longestGapDays: number;
};

function validCalendarDate(value:string):boolean {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00Z");
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}

/** Reject broken or duplicated observations rather than rank investment accounts using incorrect values. */
export function normaliseValuations(values: Valuation[]): Valuation[] {
  const sorted=[...values].sort((a,b)=>a.date.localeCompare(b.date));
  const seen=new Set<string>();
  return sorted.map(point=>{
    const amount=new Decimal(point.value);
    if(!validCalendarDate(point.date) ||
      seen.has(point.date) || !amount.isFinite() || amount.lt(0))throw new Error("INVALID_VALUATION_SERIES");
    seen.add(point.date);
    return {date:point.date,value:amount.toString()};
  });
}

function sumFlows(flows:DatedFlow[], after:string, through:string){
  return flows.reduce((sum,flow)=>{
    if(!validCalendarDate(flow.date))throw new Error("INVALID_EXTERNAL_FLOW");
    const amount=new Decimal(flow.amount);
    if(!amount.isFinite())throw new Error("INVALID_EXTERNAL_FLOW");
    return flow.date>after&&flow.date<=through?sum.plus(amount):sum;
  },new Decimal(0));
}
const msInDay=86_400_000;
const gapDays=(a:string,b:string)=>Math.round((Date.parse(b+"T00:00:00Z")-Date.parse(a+"T00:00:00Z"))/msInDay);

/**
 * Flow-adjusted snapshots presume external flows at each valued period end.
 * This is an ESTIMATE, not an exact TWR or an intraday account statement.
 * No interpolation, look-ahead, or performance before the first real valuation.
 */
export function summarizeObservedPerformance(values:Valuation[],flows:DatedFlow[]):AnalyticsSummary | null {
  const points=normaliseValuations(values);
  if(!points.length)return null;
  const first=points[0],last=points[points.length-1];
  const totalFlows=sumFlows(flows,first.date,last.date);
  const profit=new Decimal(last.value).minus(first.value).minus(totalFlows);
  let index=new Decimal(1),peak=new Decimal(1);
  let maxDrawdown=new Decimal(0),best:number|null=null,worst:number|null=null;
  let longestGap=0,usablePeriods=0,lastSessionPnl:string|null=null;
  for(let i=1;i<points.length;i++){
    const prev=points[i-1],current=points[i];
    const gap=gapDays(prev.date,current.date);
    longestGap=Math.max(longestGap,gap);
    const external=sumFlows(flows,prev.date,current.date);
    const previous=new Decimal(prev.value);
    if(previous.lte(0))return {
      startDate:first.date,endDate:last.date,observations:points.length,latestValue:last.value,
      netFlowSinceStart:totalFlows.toString(),profitSinceStart:profit.toString(),
      flowAdjustedReturnPct:null,observedMaxDrawdownPct:null,currentDrawdownPct:null,
      bestObservedSessionPct:null,worstObservedSessionPct:null,lastObservedSessionPnl:null,longestGapDays:longestGap
    };
    const pnl=new Decimal(current.value).minus(previous).minus(external);
    const rate=pnl.div(previous);
    const next=index.mul(new Decimal(1).plus(rate));
    if(next.lt(0))return null;
    index=next;peak=Decimal.max(peak,index);
    maxDrawdown=Decimal.min(maxDrawdown,index.div(peak).minus(1));
    usablePeriods++;
    // Daily/session figures must come from adjacent observations (allow weekends + holidays).
    if(gap<=4){
      const percentage=rate.mul(100).toNumber();
      best=best===null?percentage:Math.max(best,percentage);
      worst=worst===null?percentage:Math.min(worst,percentage);
      if(i===points.length-1)lastSessionPnl=pnl.toString();
    }
  }
  return {
    startDate:first.date,endDate:last.date,observations:points.length,latestValue:last.value,
    netFlowSinceStart:totalFlows.toString(),profitSinceStart:profit.toString(),
    flowAdjustedReturnPct:usablePeriods?index.minus(1).mul(100).toNumber():null,
    observedMaxDrawdownPct:usablePeriods?maxDrawdown.mul(100).toNumber():null,
    currentDrawdownPct:usablePeriods?index.div(peak).minus(1).mul(100).toNumber():null,
    bestObservedSessionPct:best,worstObservedSessionPct:worst,
    lastObservedSessionPnl:lastSessionPnl,longestGapDays:longestGap
  };
}

export function aggregateAtCommonDates(series:StrategySeries[]):{currency:string;valuations:Valuation[];flows:DatedFlow[]} | null {
  if(!series.length || new Set(series.map(s=>s.currency.toUpperCase())).size!==1)return null;
  const bySeries=series.map(s=>normaliseValuations(s.valuations));
  if(bySeries.some(s=>!s.length))return null;
  const commonDates=bySeries[0].map(v=>v.date).filter(date=>bySeries.every(series=>series.some(v=>v.date===date)));
  if(!commonDates.length)return null;
  const valuations=commonDates.map(date=>({
    date, value:bySeries.reduce((total,rows)=>total.plus(rows.find(r=>r.date===date)!.value),new Decimal(0)).toString()
  }));
  // An aggregate starts only when EVERY strategy has a trustworthy value, not when the first was opened.
  const flows=series.flatMap(s=>s.flows).filter(flow=>flow.date>commonDates[0]&&flow.date<=commonDates[commonDates.length-1]);
  return {currency:series[0].currency.toUpperCase(),valuations,flows};
}

/** Fair leaderboard: same dates, same currency, no credit for deposits. */
export function rankOnCommonHistory(series:StrategySeries[]) {
  const aggregate=aggregateAtCommonDates(series);
  if(!aggregate || aggregate.valuations.length<2)return [];
  const dates=new Set(aggregate.valuations.map(x=>x.date));
  return series.map(s=>{
    const data=s.valuations.filter(v=>dates.has(v.date));
    return {id:s.id,name:s.name,summary:summarizeObservedPerformance(data,s.flows)};
  }).filter(x=>x.summary?.flowAdjustedReturnPct!=null)
    .sort((a,b)=>Number(b.summary!.flowAdjustedReturnPct)-Number(a.summary!.flowAdjustedReturnPct));
}

/** A common 100-base index removes effects of contributions from comparisons. */
export function growthIndex(values:Valuation[],flows:DatedFlow[]):Valuation[] {
  const points=normaliseValuations(values);
  if(!points.length)return [];
  let index=new Decimal(100);
  const out:Valuation[]=[{date:points[0].date,value:"100"}];
  for(let i=1;i<points.length;i++) {
    const previous=new Decimal(points[i-1].value);
    if(previous.lte(0))return [];
    const external=sumFlows(flows,points[i-1].date,points[i].date);
    const adjusted=new Decimal(points[i].value).minus(external);
    if(adjusted.lt(0))return [];
    index=index.mul(adjusted.div(previous));
    out.push({date:points[i].date,value:index.toString()});
  }
  return out;
}
