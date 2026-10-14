import Decimal from "decimal.js";
import {equalRiskContribution} from "./tactical-math";

export type AlignedAdjustedClose={at:Date;adjustedClose:Decimal};
export type RiskParityEstimate={
 covariance:Decimal[][];
 weights:string[];
 observationDates:string[];
};
/** 252 completed common exchange sessions, 252 daily log-free simple returns.
 * Rows are chronologically increasing and pre-certified as adjusted, total-return-compatible.
 * No backfilling, forward filling or intersection dropping: every asset must have the
 * exact same dates, or the entire estimate is rejected. */
export function estimateDailyRiskParity(
 series:readonly {exposure:string;points:readonly AlignedAdjustedClose[]}[],
 asOf:Date,
 lookbackReturns=252
):RiskParityEstimate {
 if(series.length<2||series.length>32||new Set(series.map(s=>s.exposure)).size!==series.length||
    !Number.isInteger(lookbackReturns)||lookbackReturns<60||lookbackReturns>756||
    !Number.isFinite(asOf.getTime()))throw new Error("RP_INVALID_ESTIMATION_CONFIG");
 const required=lookbackReturns+1;
 const dates:string[]=[];
 const returns:Decimal[][]=[];
 series.forEach((asset,index)=>{
  if(asset.points.length!==required)throw new Error("RP_MISSING_SESSIONS:"+asset.exposure);
  let prev=-Infinity;
  const values:Decimal[]=[];
  for(let j=0;j<required;j++){
   const p=asset.points[j],t=p.at.getTime();
   if(!Number.isFinite(t)||t<=prev||t>asOf||!p.adjustedClose.isFinite()||p.adjustedClose.lte(0))throw new Error("RP_INVALID_SESSION:"+asset.exposure);
   const date=p.at.toISOString().slice(0,10);
   if(index===0){if(j>0&&dates[j-1]===date)throw new Error("RP_DUPLICATE_SESSION");dates.push(date);}
   else if(dates[j]!==date)throw new Error("RP_UNALIGNED_SESSIONS:"+asset.exposure);
   if(j>0)values.push(p.adjustedClose.div(asset.points[j-1].adjustedClose).minus(1));
   prev=t;
  }
  returns.push(values);
 });
 const means=returns.map(v=>v.reduce((s,x)=>s.plus(x),new Decimal(0)).div(lookbackReturns));
 const covariance=returns.map((a,i)=>returns.map((_,j)=>{
  let sum=new Decimal(0);
  for(let k=0;k<lookbackReturns;k++)sum=sum.plus(a[k].minus(means[i]).mul(returns[j][k].minus(means[j])));
  return sum.div(lookbackReturns-1);
 }));
 return {covariance,weights:equalRiskContribution(covariance),observationDates:dates};
}
