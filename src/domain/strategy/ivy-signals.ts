import Decimal from "decimal.js";
import type { TrustedHistoricalSeries } from "./types";

/**
 * Source-faithful Ivy 10-month monthly closing-price filter.
 * Requires EXACTLY one adjusted close for each consecutive monthly observation
 * ending at the last completed review month. Never constructs prices.
 */
export type IvyDecision = { exposure:string; invested:boolean; lastPrice:string; movingAverage:string };
export function ivyTenMonthSignals(
  assets:readonly string[],
  history:readonly TrustedHistoricalSeries[],
  reviewMonth:string,
  currency:string
):IvyDecision[] {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(reviewMonth))throw new Error("INVALID_IVY_REVIEW_MONTH");
  if(assets.length!==5 || new Set(assets).size!==5 || assets.some(x=>!x))throw new Error("INVALID_IVY_UNIVERSE");
  const [year,month]=reviewMonth.split("-").map(Number);
  // Compute the precise trailing set of calendar months, including review month.
  const required=Array.from({length:10},(_,i)=>{
    const monthStart=new Date(Date.UTC(year,month-1-(9-i),1));
    return monthStart.toISOString().slice(0,7);
  });
  return assets.map(exposure=>{
    const matches=history.filter(x=>x.exposure===exposure && x.currency===currency && !!x.source);
    if(matches.length!==1)throw new Error("IVY_HISTORY_MISSING_OR_AMBIGUOUS:"+exposure);
    const observations=new Map<string,Decimal>();
    for(const p of matches[0].points){
      if(!Number.isFinite(p.at.getTime()) || !p.adjustedClose.isFinite()||p.adjustedClose.lte(0))throw new Error("IVY_INVALID_PRICE");
      const key=p.at.toISOString().slice(0,7);
      // Ignore future months but reject duplicates within the review history.
      if(key>reviewMonth)continue;
      if(observations.has(key))throw new Error("IVY_MULTIPLE_MONTHLY_CLOSES:"+key);
      observations.set(key,p.adjustedClose);
    }
    const prices=required.map(key=>{
      const p=observations.get(key);
      if(!p)throw new Error("IVY_HISTORY_GAP:"+exposure+":"+key);
      return p;
    });
    const avg=prices.reduce((a,b)=>a.plus(b),new Decimal(0)).div(10);
    const last=prices[9];
    return {exposure,invested:last.gt(avg),lastPrice:last.toString(),movingAverage:avg.toString()};
  });
}
