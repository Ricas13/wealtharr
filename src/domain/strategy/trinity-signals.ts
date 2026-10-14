import Decimal from "decimal.js";
import type {TrustedHistoricalSeries} from "./types";

/**
 * Source-locked Global Trend half of the Trinity 50/50 approach.
 * Observe historical *monthly* total-return/adjusted closes only. At a month-end
 * review rank 10 unique assets on mean 1/3/6/12 month returns, take top five,
 * and permit each only when latest price exceeds the 10-month simple moving
 * average. Excluded slots go to the caller's verified Treasury-bill exposure.
 *
 * Returned weights apply to the 50% Global Trend sleeve: 20% each of five
 * selection slots. The separate buy-and-hold half must be managed independently.
 * Reference: https://mebfaber.com/2016/08/19/episode-15-trinity-portfolio/
 */
export type TrinitySignal={riskWeights:ReadonlyArray<{exposure:string;weight:string}>;defensiveWeight:string;
  ranked:ReadonlyArray<{exposure:string;momentum:string;aboveTrend:boolean}>};
export function trinityGlobalTrendSignal(series:readonly TrustedHistoricalSeries[], reviewClose:Date):TrinitySignal{
  if(!Number.isFinite(reviewClose.getTime())||series.length!==10||
    new Set(series.map(s=>s.exposure)).size!==10)throw new Error("TRINITY_UNIVERSE_INCOMPLETE");
  const scored=series.map(s=>{
    if(!s.exposure||!s.source||!s.currency||s.points.length<13)throw new Error("TRINITY_HISTORY_INCOMPLETE");
    const sorted=[...s.points].sort((a,b)=>a.at.getTime()-b.at.getTime());
    if(sorted.some((p,i)=>!Number.isFinite(p.at.getTime())||p.at>reviewClose||
      !p.adjustedClose.isFinite()||p.adjustedClose.lte(0)||
      (i>0&&(p.at.getTime()<=sorted[i-1].at.getTime()||
      p.at.getUTCFullYear()===sorted[i-1].at.getUTCFullYear()&&p.at.getUTCMonth()===sorted[i-1].at.getUTCMonth()))))
      throw new Error("TRINITY_HISTORY_INVALID");
    const end=sorted.at(-1)!;
    // Observations supplied must be consecutive end-of-month total-return snapshots.
    const last12=sorted.slice(-13);
    for(let i=1;i<last12.length;i++){
      const a=last12[i-1].at,b=last12[i].at;
      if((b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth()!==1)
        throw new Error("TRINITY_MISSING_MONTH");
    }
    if(end.at.getUTCFullYear()!==reviewClose.getUTCFullYear()||
      end.at.getUTCMonth()!==reviewClose.getUTCMonth())throw new Error("TRINITY_STALE_MONTH_END");
    const px=last12.map(p=>p.adjustedClose);
    const last=px[12];
    const momentum=[1,3,6,12].reduce((total,n)=>total.plus(last.div(px[12-n]).minus(1)),new Decimal(0)).div(4);
    const movingAverage=px.slice(3,13).reduce((total,p)=>total.plus(p),new Decimal(0)).div(10);
    return {exposure:s.exposure,momentum,aboveTrend:last.gt(movingAverage)};
  }).sort((a,b)=>b.momentum.cmp(a.momentum)||a.exposure.localeCompare(b.exposure));
  const selected=scored.slice(0,5);
  const riskWeights=selected.filter(s=>s.aboveTrend).map(s=>({exposure:s.exposure,weight:"0.20"}));
  const defensiveWeight=new Decimal(5-riskWeights.length).mul("0.20").toFixed(2);
  return {riskWeights,defensiveWeight,
    ranked:scored.map(s=>({exposure:s.exposure,momentum:s.momentum.toFixed(12),aboveTrend:s.aboveTrend}))};
}
