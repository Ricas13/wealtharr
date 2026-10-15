import Decimal from "decimal.js";
import type {TrustedHistoricalSeries} from "./types";

export type SignalWeight={exposure:string;weight:string};
export type MonthClose={month:string;price:Decimal};

/** A closed month is available only if the supplied observation precedes the decision timestamp.
 * The adapter must certify that the observation is the final exchange-session close for that month.
 * An arbitrary intra-month observation is not sufficient. */
export function strictMonthlyCloses(series:TrustedHistoricalSeries, reviewMonth:string, count:number, asOf:Date):Decimal[]{
 if(!series.source||!/^\d{4}-(0[1-9]|1[0-2])$/.test(reviewMonth)||!Number.isFinite(asOf.getTime())||count<2)throw new Error("MONTHLY_HISTORY_INVALID_REQUEST");
 const [y,m]=reviewMonth.split("-").map(Number);
 const monthAfter=new Date(Date.UTC(y,m,1));
 if(asOf<monthAfter)throw new Error("MONTH_NOT_COMPLETE");
 const map=new Map<string,Decimal>();
 const monthlyPoints=series.points.some(p=>p.monthTerminalCertified!==undefined)
  ?series.points.filter(p=>p.monthTerminalCertified===true):series.points;
 for(const p of monthlyPoints){
  if(!Number.isFinite(p.at.getTime())||p.at.getTime()>asOf.getTime()||!p.adjustedClose.isFinite()||p.adjustedClose.lte(0))throw new Error("MONTHLY_HISTORY_INVALID_BAR");
  const key=p.at.toISOString().slice(0,7);
  if(key>reviewMonth)continue;
  if(map.has(key))throw new Error("MONTHLY_HISTORY_DUPLICATE_CLOSE:"+key);
  map.set(key,p.adjustedClose);
 }
 return Array.from({length:count},(_,i)=>{
  const key=new Date(Date.UTC(y,m-count+i,1)).toISOString().slice(0,7);
  const price=map.get(key);
  if(!price)throw new Error("MONTHLY_HISTORY_GAP:"+key);
  return price;
 });
}
export function trailingReturn(prices:readonly Decimal[]):Decimal {
 if(prices.length<2||prices.some(p=>!p.isFinite()||p.lte(0)))throw new Error("RETURN_INVALID_HISTORY");
 return prices[prices.length-1].div(prices[0]).minus(1);
}
/** Classic GEM: relative momentum compares US and ex-US equity total returns.
 * Absolute momentum is US equity's 12-month return over 12-month T-bill return.
 * Signals are evaluated after the completed month; trades occur afterward. */
export function classicGemDecision(args:{
 us:readonly Decimal[];exUs:readonly Decimal[];tbills:readonly Decimal[];
 usExposure:string;exUsExposure:string;bondExposure:string;
}):string {
 const {us,exUs,tbills}=args;
 if([us,exUs,tbills].some(p=>p.length!==13)||new Set([args.usExposure,args.exUsExposure,args.bondExposure]).size!==3)throw new Error("GEM_INVALID_INPUT");
 const u=trailingReturn(us),i=trailingReturn(exUs),b=trailingReturn(tbills);
 if(u.lte(b))return args.bondExposure;
 return u.gte(i)?args.usExposure:args.exUsExposure;
}
/** Exactly 200 distinct completed exchange sessions: signal close is compared
 * with the arithmetic mean of the trailing 200 adjusted daily closes. */
export function trend200Decision(prices:readonly {at:Date;adjustedClose:Decimal}[],asOf:Date):{invested:boolean;close:string;average:string}{
 if(prices.length!==200||!Number.isFinite(asOf.getTime()))throw new Error("TREND_REQUIRES_200_SESSIONS");
 let prev=-Infinity;let sum=new Decimal(0);
 for(const p of prices){
  const t=p.at.getTime();
  if(!Number.isFinite(t)||t<=prev||t>asOf.getTime()||!p.adjustedClose.isFinite()||p.adjustedClose.lte(0))throw new Error("TREND_INVALID_OR_DUPLICATE_SESSION");
  prev=t;sum=sum.plus(p.adjustedClose);
 }
 const avg=sum.div(200),last=prices[199].adjustedClose;
 return {invested:last.gt(avg),close:last.toString(),average:avg.toString()};
}
/** Equal-risk-contribution long-only covariance risk parity.
 * Decimal Newton coordinate minimisation of 0.5*x'Cx - sum(log(x_i))
 * has optimum x_i (Cx)_i = 1, hence equal risk contributions.
 * Matrix must be strictly positive definite. No leverage, borrowing, or shorts.
 */
export function equalRiskContribution(covariance:readonly (readonly Decimal[])[], tolerance="0.0000001"):string[]{
 const n=covariance.length;
 if(n<2||n>32||covariance.some(row=>row.length!==n))throw new Error("RP_INVALID_DIMENSION");
 const c=covariance;
 for(let i=0;i<n;i++)for(let j=0;j<n;j++){
  if(!c[i][j].isFinite()||!c[i][j].eq(c[j][i]))throw new Error("RP_INVALID_COVARIANCE");
 }
 // Strict positive definiteness, including rejection of singular inputs.
 const L:Decimal[][]=Array.from({length:n},()=>Array.from({length:n},()=>new Decimal(0)));
 for(let i=0;i<n;i++)for(let j=0;j<=i;j++){
  let v=c[i][j];
  for(let k=0;k<j;k++)v=v.minus(L[i][k].mul(L[j][k]));
  if(i===j){if(v.lte(0))throw new Error("RP_NON_POSITIVE_DEFINITE");L[i][j]=v.sqrt();}
  else L[i][j]=v.div(L[j][j]);
 }
 const tol=new Decimal(tolerance);
 if(!tol.isFinite()||tol.lte(0)||tol.gte("0.01"))throw new Error("RP_INVALID_TOLERANCE");
 const x=Array.from({length:n},()=>new Decimal(1));
 for(let iteration=0;iteration<20000;iteration++){
  for(let i=0;i<n;i++){
   let cross=new Decimal(0);
   for(let j=0;j<n;j++)if(j!==i)cross=cross.plus(c[i][j].mul(x[j]));
   // Positive root of c_ii*x_i^2 + cross*x_i - 1=0.
   x[i]=new Decimal(2).div(cross.plus(cross.pow(2).plus(c[i][i].mul(4)).sqrt()));
  }
  const products=x.map((xi,i)=>xi.mul(c[i].reduce((s,cij,j)=>s.plus(cij.mul(x[j])),new Decimal(0))));
  const worst=products.reduce((max,v)=>Decimal.max(max,v.minus(1).abs()),new Decimal(0));
  if(worst.lte(tol)){
   const total=x.reduce((s,v)=>s.plus(v),new Decimal(0));
   return x.map(v=>v.div(total).toString());
  }
 }
 throw new Error("RP_OPTIMISATION_DID_NOT_CONVERGE");
}
