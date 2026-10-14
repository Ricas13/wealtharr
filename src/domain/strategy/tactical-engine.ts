import Decimal from "decimal.js";
import {calculateTacticalAllocation,type TacticalVariant} from "./tactical-allocation";
import type {StrategyEngine,EngineContext,ProposedAction,TrustedHistoricalSeries} from "./types";

type TacticalConfig={variant:TacticalVariant;riskAssets:string[];defensiveAssets:string[];
 reviewFrequency:"MONTHLY";rebalanceThreshold:"0";};
const variants=new Set<TacticalVariant>(["TREND_200_DAILY","GEM_CLASSIC","IVY_GTAA5","PAA_12_A2","VAA_G4","VAA_G12","RISK_PARITY_ERC_252"]);
function parse(config:Record<string,unknown>):TacticalConfig{
 const riskAssets=config.riskAssets,defensiveAssets=config.defensiveAssets;
 if(!variants.has(config.variant as TacticalVariant)||!Array.isArray(riskAssets)||!Array.isArray(defensiveAssets)||
   !riskAssets.length||!defensiveAssets.length||riskAssets.some(x=>typeof x!=="string"||!x.trim())||
   defensiveAssets.some(x=>typeof x!=="string"||!x.trim())||config.reviewFrequency!=="MONTHLY"||
   config.rebalanceThreshold!=="0")throw new Error("TACTICAL_INVALID_CONFIG");
 const v=config.variant as TacticalVariant;
 if(riskAssets.length!==(v==="TREND_200_DAILY"?1:v==="GEM_CLASSIC"?2:v==="IVY_GTAA5"?5:v==="PAA_12_A2"?12:v==="VAA_G4"?4:v==="VAA_G12"?12:riskAssets.length)||
    defensiveAssets.length!==(v==="GEM_CLASSIC"?2:v==="VAA_G4"||v==="VAA_G12"?3:1))throw new Error("TACTICAL_INVALID_UNIVERSE");
 if(v==="RISK_PARITY_ERC_252"&&(riskAssets.length<2||riskAssets.length>32))throw new Error("RP_INVALID_UNIVERSE");
 return {variant:v,riskAssets:[...riskAssets],defensiveAssets:[...defensiveAssets],reviewFrequency:"MONTHLY",rebalanceThreshold:"0"};
}
function dataRequired(ctx:EngineContext,reason:string):ProposedAction{
 return {actionType:"DATA_REQUIRED",title:"Verified tactical history required",instruction:reason,
  explanation:[],nextState:ctx.state,confidence:"LOW",dueAt:ctx.now,reasonCode:"TACTICAL_HISTORY_UNVERIFIED"};
}
/** Pure strategy adapter for action-service. Every recalc recomputes target weights
 * from certified immutable signal evidence; the common fixed-allocation lifecycle
 * still sizes the next trade from actual current holdings and cash. */
export const tacticalAllocationEngine:StrategyEngine={
 key:"TACTICAL_ALLOCATION",
 validateConfig(raw){parse(raw);},
 calculate(ctx){
  let cfg:TacticalConfig;
  try{cfg=parse(ctx.config);}catch{return dataRequired(ctx,"Stored tactical version has invalid immutable rules.");}
  if(ctx.dataHealth.status!=="CURRENT")return dataRequired(ctx,ctx.dataHealth.message??"Latest quotes are missing or stale.");
  if(!ctx.reviewDue)return {actionType:"NO_ACTION",title:"Tactical review not due",instruction:"Continue the existing allocation until the next scheduled review.",
   explanation:[],nextState:ctx.state,confidence:"HIGH",dueAt:ctx.nextReviewAt};
  const histories=ctx.trustedHistory;
  if(!histories)return dataRequired(ctx,"Historical adjusted daily closes are not available.");
  // Signal certification is a property of the ingested data, not an admin-editable
  // strategy config flag, market selection, or investor-provided input.
  if(histories.some(h=>h.calendarCertified!==true||h.totalReturnCertified!==true))
   return dataRequired(ctx,"Market provider has not certified total-return treatment and completed exchange sessions.");
  const prevMonth=new Date(Date.UTC(ctx.now.getUTCFullYear(),ctx.now.getUTCMonth()-1,1)).toISOString().slice(0,7);
  try{
   const weights=calculateTacticalAllocation({
    variant:cfg.variant,currency:ctx.baseCurrency,reviewMonth:prevMonth,asOf:ctx.now,
    riskAssets:cfg.riskAssets,defensiveAssets:cfg.defensiveAssets,history:histories,
    calendarCertified:true,totalReturnCertified:true
   });
   if(weights.some(w=>!new Decimal(w.weight).isFinite()||new Decimal(w.weight).lt(0))||
      !weights.reduce((sum,w)=>sum.plus(w.weight),new Decimal(0)).eq(1))
      return dataRequired(ctx,"Signal target weights do not sum to one.");
   // Incorporate every potential exposure, including now-zero signal sleeves, so
   // the common engine can sell obsolete assets after a regime change.
   const universe=[...new Set([...cfg.riskAssets,...cfg.defensiveAssets])];
   const mapped=new Map(weights.map(w=>[w.exposure,w.weight]));
   const current=ctx.exposures.filter(p=>p.value.gt(0));
   const target=universe.map(exposure=>({exposure,weight:mapped.get(exposure)??"0"}));
   // fixedAllocationEngine forbids zero-weight allocations. Instead directly find
   // the largest required sale, then available-cash buy, using confirmed fills.
   const total=current.reduce((s,p)=>s.plus(p.value),ctx.cash);
   if(!total.isFinite()||total.lte(0))return dataRequired(ctx,"No reconciled positive portfolio value.");
   if(current.some(p=>!universe.includes(p.economicExposure)||p.value.lt(0)))return dataRequired(ctx,"A position is outside the versioned tactical universe.");
   const deltas=target.map(t=>({exposure:t.exposure,delta:total.mul(t.weight).minus(
    current.filter(p=>p.economicExposure===t.exposure).reduce((s,p)=>s.plus(p.value),new Decimal(0)))}));
   const sells=deltas.filter(d=>d.delta.lt("-0.005")).sort((a,b)=>a.delta.cmp(b.delta));
   const buys=deltas.filter(d=>d.delta.gt("0.005")).sort((a,b)=>b.delta.cmp(a.delta));
   const reviewState={...ctx.state,tacticalSignalMonth:prevMonth,tacticalVariant:cfg.variant,
     tacticalTargetWeights:weights};
   const explanation=weights.map(w=>({label:w.exposure,value:new Decimal(w.weight).mul(100).toString()+"%"}));
   if(sells.length){
    const p=sells[0];return {actionType:"SELL",title:"Tactical rotation: sell "+p.exposure,
     instruction:"Sell the indicated exposure, confirm the actual execution, then recalculate.",
     amount:p.delta.abs().toDecimalPlaces(2),economicExposure:p.exposure,currency:ctx.baseCurrency,
     explanation,nextState:reviewState,confidence:"HIGH",dueAt:ctx.now,completesReview:false};
   }
   if(buys.length&&ctx.cash.gt("0.005")){
    const p=buys[0],amount=Decimal.min(ctx.cash,p.delta).toDecimalPlaces(2);
    return {actionType:"BUY",title:"Tactical allocation: buy "+p.exposure,
     instruction:"Buy from available reconciled cash, confirm the execution, then recalculate.",
     amount,economicExposure:p.exposure,currency:ctx.baseCurrency,explanation,nextState:reviewState,
     confidence:"HIGH",dueAt:ctx.now,completesReview:false};
   }
   if(buys.length)return dataRequired(ctx,"Insufficient reconciled cash to complete target; verify prior sales.");
   return {actionType:"HOLD",title:"Tactical target complete",instruction:"Confirmed holdings match the signal targets.",
     explanation,nextState:reviewState,confidence:"HIGH",dueAt:ctx.now,completesReview:true};
  }catch(e){
   return dataRequired(ctx,e instanceof Error?e.message:"Tactical signal data invalid.");
  }
 }
};
