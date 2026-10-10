import Decimal from "decimal.js";
import type { ResolvedPosition } from "@/domain/strategy/market-eligibility";

type AllocationLine={exposure:string;ticker:string;exchange:string;currency:string;amount:string;weight:string};
export type InitialAllocationPlan={investAmount:string;cashReserve:string;currency:string;orders:AllocationLine[]};

/** This is an allocation instruction in money, not a broker order or guessed number of shares. */
export function initialAllocationPlan(engine:string,config:Record<string,unknown>,
  cash:Decimal.Value,currency:string,positions:ResolvedPosition[]):InitialAllocationPlan | null {
  const amount=new Decimal(cash);
  if(!amount.isFinite()||amount.lte(0))return null;
  let targets:Array<{exposure:string;weight:Decimal}>=[];
  if(engine==="FIXED_ALLOCATION"&&Array.isArray(config.allocations)) {
    targets=config.allocations.map((x:unknown)=>{
      const a=x as {exposure:string;weight:string};
      return {exposure:a.exposure,weight:new Decimal(a.weight)};
    });
  } else if(engine==="VALUE_TARGET"){
    targets=[{exposure:String(config.targetExposure),weight:new Decimal(String(config.initialTargetRatio??"0.6"))}];
  } else return null;
  if(targets.length<1||targets.some(x=>!x.exposure||!x.weight.isFinite()||x.weight.lte(0)))return null;
  const totalWeight=targets.reduce((sum,x)=>sum.plus(x.weight),new Decimal(0));
  if(totalWeight.gt(1))return null;
  if(engine==="FIXED_ALLOCATION"&&!totalWeight.eq(1))return null;
  const orders:AllocationLine[]=[];
  let allocated=new Decimal(0);
  for(let i=0;i<targets.length;i++){
    const t=targets[i];
    const match=positions.find(p=>p.economicExposure===t.exposure&&p.currency.toUpperCase()===currency.toUpperCase());
    if(!match)return null;
    const value=(i===targets.length-1&&totalWeight.eq(1)?
      amount.minus(allocated):amount.mul(t.weight)).toDecimalPlaces(2,Decimal.ROUND_HALF_EVEN);
    allocated=allocated.plus(value);
    orders.push({exposure:t.exposure,ticker:match.ticker,exchange:match.exchange,currency,
      amount:value.toFixed(2),weight:t.weight.mul(100).toString()});
  }
  const reserve=amount.minus(allocated);
  if(reserve.lt(0))return null;
  return {investAmount:amount.toFixed(2),cashReserve:reserve.toFixed(2),currency,orders};
}
