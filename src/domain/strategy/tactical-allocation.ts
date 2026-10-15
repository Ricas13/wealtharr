import Decimal from "decimal.js";
import {trend200Decision,strictMonthlyCloses,classicGemDecision} from "./tactical-math";
import {estimateDailyRiskParity} from "./risk-parity-estimator";
import {ivyTenMonthSignals} from "./ivy-signals";
import {paaReferenceAllocation} from "./paa-signals";
import {vaaAllocation,type BreadthVariant} from "./vaa-signals";
import type {TrustedHistoricalSeries} from "./types";

export type TacticalVariant="TREND_200_DAILY"|"GEM_CLASSIC"|"IVY_GTAA5"|"PAA_12_A2"|"VAA_G4"|"VAA_G12"|"RISK_PARITY_ERC_252";
export type TacticalRequest={
 variant:TacticalVariant;currency:string;reviewMonth:string;asOf:Date;
 riskAssets:readonly string[];defensiveAssets:readonly string[];history:readonly TrustedHistoricalSeries[];
 /** True only after provider and session calendar independently certify all bars in review. */
 calendarCertified:boolean;
 /** True only after provider attests split/dividend total-return semantics for every series. */
 totalReturnCertified:boolean;
};
export type TacticalAllocation={exposure:string;weight:string};
/** Fail-closed allocation calculator; it never fabricates prices, currencies or trading lines. */
export function calculateTacticalAllocation(req:TacticalRequest):TacticalAllocation[]{
 if(!req.calendarCertified||!req.totalReturnCertified)throw new Error("TACTICAL_SOURCE_CERTIFICATION_REQUIRED");
 if(!req.currency||!Number.isFinite(req.asOf.getTime())||!/^\d{4}-(0[1-9]|1[0-2])$/.test(req.reviewMonth))throw new Error("TACTICAL_INVALID_REQUEST");
 const risk=[...req.riskAssets],def=[...req.defensiveAssets],all=[...risk,...def];
 if(!risk.length||(req.variant!=="RISK_PARITY_ERC_252"&&!def.length)||all.some(x=>!x)||new Set(risk).size!==risk.length||new Set(def).size!==def.length||
    (!(req.variant==="VAA_G4"||req.variant==="VAA_G12")&&new Set(all).size!==all.length))throw new Error("TACTICAL_INVALID_UNIVERSE");
 const series=(id:string)=>{
  const matches=req.history.filter(s=>s.exposure===id&&s.currency===req.currency&&Boolean(s.source));
  if(matches.length!==1)throw new Error("TACTICAL_MISSING_OR_AMBIGUOUS_HISTORY:"+id);
  return matches[0];
 };
 // All required legs must have independently sourced evidence, including defensive legs.
 all.forEach(series);
 const alloc=(id:string)=>[{exposure:id,weight:"1"}];
 const monthly=(id:string,count:number)=>strictMonthlyCloses(series(id),req.reviewMonth,count,req.asOf);
 switch(req.variant){
  case "TREND_200_DAILY":{
   if(risk.length!==1||def.length!==1)throw new Error("TREND_INVALID_UNIVERSE");
   const points=series(risk[0]).points;
   if(points.length<200)throw new Error("TREND_REQUIRES_200_SESSIONS");
   return alloc(trend200Decision(points.slice(-200),req.asOf).invested?risk[0]:def[0]);
  }
  case "GEM_CLASSIC":{
   if(risk.length!==2||def.length!==2)throw new Error("GEM_INVALID_UNIVERSE");
   const selected=classicGemDecision({
    us:monthly(risk[0],13),exUs:monthly(risk[1],13),tbills:monthly(def[0],13),
    usExposure:risk[0],exUsExposure:risk[1],bondExposure:def[1]
   });
   // Defensive aggregate bond history is required, although not used to rank.
   monthly(def[1],13);
   return alloc(selected);
  }
  case "IVY_GTAA5":{
   if(risk.length!==5||def.length!==1)throw new Error("IVY_INVALID_UNIVERSE");
   // The existing reference helper requires exactly ten monthly observations;
   // use strict monthly session checks before passing canonical observations.
   const complete=risk.map(id=>({...series(id),points:monthly(id,10).map((p,i)=>{
    const [y,m]=req.reviewMonth.split("-").map(Number);
    return {at:new Date(Date.UTC(y,m-10+i,1)),adjustedClose:p};
   })}));
   monthly(def[0],10);
   const signals=ivyTenMonthSignals(risk,complete,req.reviewMonth,req.currency);
   const active=signals.filter(s=>s.invested);
   return [...active.map(s=>({exposure:s.exposure,weight:"0.2"})),
    {exposure:def[0],weight:new Decimal(5-active.length).div(5).toString()}].filter(x=>new Decimal(x.weight).gt(0));
  }
  case "PAA_12_A2":{
   if(risk.length!==12||def.length!==1)throw new Error("PAA_INVALID_UNIVERSE");
   const allHistory=[...new Set(all)].map(id=>({...series(id),points:monthly(id,13).map((p,i)=>{
    const [y,m]=req.reviewMonth.split("-").map(Number);
    return {at:new Date(Date.UTC(y,m-13+i,1)),adjustedClose:p};
   })}));
   return paaReferenceAllocation({riskAssets:risk,safeAssets:def,history:allHistory,currency:req.currency,reviewMonth:req.reviewMonth});
  }
  case "VAA_G4":
  case "VAA_G12":{
   if(risk.length!==(req.variant==="VAA_G4"?4:12)||def.length!==3)throw new Error("VAA_INVALID_UNIVERSE");
   const allHistory=all.map(id=>({...series(id),points:monthly(id,13).map((p,i)=>{
    const [y,m]=req.reviewMonth.split("-").map(Number);
    return {at:new Date(Date.UTC(y,m-13+i,1)),adjustedClose:p};
   })}));
   return vaaAllocation({variant:req.variant as BreadthVariant,offensive:risk,defensive:def,history:allHistory,currency:req.currency,reviewMonth:req.reviewMonth});
  }
  case "RISK_PARITY_ERC_252":{
   if(risk.length<2||def.length!==0)throw new Error("RP_INVALID_UNIVERSE");
   const estimate=estimateDailyRiskParity(risk.map(id=>({exposure:id,points:series(id).points.slice(-253)})),req.asOf,252);
   return risk.map((exposure,i)=>({exposure,weight:estimate.weights[i]}));
  }
  default:throw new Error("TACTICAL_UNSUPPORTED_VARIANT");
 }
}
