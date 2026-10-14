import Decimal from "decimal.js";
import type { TrustedHistoricalSeries } from "./types";

export type TargetWeight={exposure:string;weight:string};
export type BreadthVariant="VAA_G4"|"VAA_G12";
const VARIANTS={
 VAA_G4:{top:1,breadth:1},
 VAA_G12:{top:2,breadth:4}
} as const;
export function weighted13612(prices:readonly Decimal[]):Decimal{
 if(prices.length!==13||prices.some(x=>!x.isFinite()||x.lte(0)))throw new Error("INVALID_VAA_HISTORY");
 const cur=prices[12];
 return cur.div(prices[11]).minus(1).mul(12)
   .plus(cur.div(prices[9]).minus(1).mul(4))
   .plus(cur.div(prices[6]).minus(1).mul(2))
   .plus(cur.div(prices[0]).minus(1));
}
function seriesPrices(series:TrustedHistoricalSeries,reviewMonth:string):Decimal[]{
 if(!series.source||series.points.length!==13)throw new Error("VAA_HISTORY_REQUIRED");
 const [year,month]=reviewMonth.split("-").map(Number);
 const map=new Map<string,Decimal>();
 for(const p of series.points){
  if(!Number.isFinite(p.at.getTime())||!p.adjustedClose.isFinite()||p.adjustedClose.lte(0))throw new Error("VAA_INVALID_PRICE");
  const key=p.at.toISOString().slice(0,7);
  if(map.has(key))throw new Error("VAA_DUPLICATE_MONTH");
  map.set(key,p.adjustedClose);
 }
 return Array.from({length:13},(_,i)=>{
  const key=new Date(Date.UTC(year,month-1-12+i,1)).toISOString().slice(0,7);
  const value=map.get(key);if(!value)throw new Error("VAA_MONTH_GAP:"+key);
  return value;
 });
}
/** Exact named 2017 VAA-G4/G12 Easy Trading (ET) portfolio allocation. */
export function vaaAllocation(args:{
 variant:BreadthVariant;offensive:string[];defensive:string[];history:TrustedHistoricalSeries[];
 currency:string;reviewMonth:string;
}):TargetWeight[]{
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.reviewMonth))throw new Error("VAA_INVALID_MONTH");
 const rule=VARIANTS[args.variant];
 if(!rule)throw new Error("VAA_UNKNOWN_VARIANT");
 if(args.offensive.length!==(args.variant==="VAA_G4"?4:12)||args.defensive.length!==3||
  [...args.offensive,...args.defensive].some(x=>!x)||new Set(args.offensive).size!==args.offensive.length||
  new Set(args.defensive).size!==args.defensive.length)throw new Error("VAA_INVALID_UNIVERSE");
 const score=(exposure:string)=>{
  const matches=args.history.filter(s=>s.exposure===exposure&&s.currency===args.currency);
  if(matches.length!==1)throw new Error("VAA_AMBIGUOUS_OR_MISSING_HISTORY:"+exposure);
  return weighted13612(seriesPrices(matches[0],args.reviewMonth));
 };
 const risky=args.offensive.map(exposure=>({exposure,score:score(exposure)})).sort((a,b)=>b.score.cmp(a.score)||a.exposure.localeCompare(b.exposure));
 const safe=args.defensive.map(exposure=>({exposure,score:score(exposure)})).sort((a,b)=>b.score.cmp(a.score)||a.exposure.localeCompare(b.exposure));
 const bad=risky.filter(x=>x.score.lte(0)).length;
 // Paper Section 4: CF_ET=(1/T)*floor(bad*T/B), saturated at 1.
 // Replace the weakest of the initial Top-T slots, do not fractionally shrink them.
 const safeSlots=Math.min(rule.top,Math.floor(bad*rule.top/rule.breadth));
 const protective=new Decimal(safeSlots).div(rule.top);
 const weights=new Map<string,Decimal>();
 for(const item of risky.slice(0,rule.top-safeSlots))
  weights.set(item.exposure,(weights.get(item.exposure)??new Decimal(0)).plus(new Decimal(1).div(rule.top)));
 if(safeSlots>0){
  const winner=safe[0].exposure;
  weights.set(winner,(weights.get(winner)??new Decimal(0)).plus(protective));
 }
 return [...weights.entries()].map(([exposure,weight])=>({exposure,weight:weight.toString()}));
}
