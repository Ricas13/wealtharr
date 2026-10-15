import Decimal from "decimal.js";
import type {TrustedHistoricalSeries} from "./types";
export type PaaWeight={exposure:string;weight:string};
/** Canonical PAA-12 a=2 reference calculator, single intermediate-Treasury protection. */
export function paaReferenceAllocation(args:{
 riskAssets:string[];safeAssets:string[];history:TrustedHistoricalSeries[];
 currency:string;reviewMonth:string;
}):PaaWeight[]{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.reviewMonth))throw new Error("PAA_INVALID_REVIEW_MONTH");
 if(args.riskAssets.length!==12||args.safeAssets.length!==1||
  new Set(args.riskAssets).size!==12||new Set(args.safeAssets).size!==args.safeAssets.length||
  [...args.riskAssets,...args.safeAssets].some(x=>!x))throw new Error("PAA_INVALID_UNIVERSE");
 const [year,month]=args.reviewMonth.split("-").map(Number);
 const required=Array.from({length:13},(_,i)=>new Date(Date.UTC(year,month-1-12+i,1)).toISOString().slice(0,7));
 const signal=(exposure:string)=>{
  const found=args.history.filter(x=>x.exposure===exposure&&x.currency===args.currency&&x.source);
  if(found.length!==1||found[0].points.length!==13)throw new Error("PAA_HISTORY_UNAVAILABLE:"+exposure);
  const values=new Map<string,Decimal>();
  for(const row of found[0].points){
   if(!Number.isFinite(row.at.getTime())||!row.adjustedClose.isFinite()||row.adjustedClose.lte(0))throw new Error("PAA_INVALID_PRICE");
   const key=row.at.toISOString().slice(0,7);
   if(values.has(key))throw new Error("PAA_DUPLICATE_MONTH");
   values.set(key,row.adjustedClose);
  }
  const prices=required.map(key=>{const v=values.get(key);if(!v)throw new Error("PAA_MISSING_MONTH:"+key);return v;});
  const avg=prices.reduce((sum,p)=>sum.plus(p),new Decimal(0)).div(13);
  return prices[12].div(avg).minus(1);
 };
 const risky=args.riskAssets.map(exposure=>({exposure,m:signal(exposure)})).sort((a,b)=>b.m.cmp(a.m)||a.exposure.localeCompare(b.exposure));
 const safe=args.safeAssets.map(exposure=>({exposure,m:signal(exposure)})).sort((a,b)=>b.m.cmp(a.m)||a.exposure.localeCompare(b.exposure));
 const positive=risky.filter(x=>x.m.gt(0)).length;
 const bonds=Decimal.min(1,new Decimal(12-positive).div(6));
 const stocks=new Decimal(1).minus(bonds);
 const weights=new Map<string,Decimal>();
 if(stocks.gt(0))for(const item of risky.slice(0,6))weights.set(item.exposure,stocks.div(6));
 if(bonds.gt(0)){
  const e=safe[0].exposure;weights.set(e,(weights.get(e)??new Decimal(0)).plus(bonds));
 }
 return [...weights.entries()].map(([exposure,weight])=>({exposure,weight:weight.toString()}));
}
