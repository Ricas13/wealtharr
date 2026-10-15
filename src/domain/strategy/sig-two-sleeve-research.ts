import Decimal from "decimal.js";

/** Two-sleeve signal planner: stock fund + invested bond fund, NOT spare cash. */
export type SigSleeves={
  stockValue:Decimal.Value;bondValue:Decimal.Value;
  uninvestedCash:Decimal.Value;targetStockValue:Decimal.Value;
  confirmedStockBuysThisQuarter:Decimal.Value;bondBalanceAtQuarterStart:Decimal.Value;
  maxQuarterBondUse:Decimal.Value;
};
export type SigSleeveLeg={side:"BUY"|"SELL";sleeve:"STOCK"|"BOND";amount:string};
const money=(v:Decimal)=>v.toFixed();
export function planSigSleeveTransfers(input:SigSleeves):{
  legs:SigSleeveLeg[];targetGap:string;residualGap:string
}{
  const numbers=Object.entries(input).map(([k,v])=>{
    const n=new Decimal(v);
    if(!n.isFinite()||n.lt(0))throw new Error("INVALID_SIG_SLEEVE:"+k);
    return [k,n] as const;
  });
  const m=Object.fromEntries(numbers) as Record<keyof SigSleeves,Decimal>;
  if(m.maxQuarterBondUse.gt(1))throw new Error("SIG_BOND_USE_FRACTION_INVALID");
  const gap=m.targetStockValue.minus(m.stockValue),legs:SigSleeveLeg[]=[];
  if(gap.lt(0)){
    const size=gap.neg();
    legs.push({side:"SELL",sleeve:"STOCK",amount:money(size)});
    legs.push({side:"BUY",sleeve:"BOND",amount:money(size.plus(m.uninvestedCash))});
    return {legs,targetGap:money(gap),residualGap:"0"};
  }
  const availableBudget=Decimal.max(0,m.bondBalanceAtQuarterStart.mul(m.maxQuarterBondUse).minus(m.confirmedStockBuysThisQuarter));
  const cashUsed=Decimal.min(gap,m.uninvestedCash);
  const bondUsed=Decimal.min(Decimal.max(0,gap.minus(cashUsed)),m.bondValue,availableBudget);
  if(bondUsed.gt(0))legs.push({side:"SELL",sleeve:"BOND",amount:money(bondUsed)});
  const stockOrder=cashUsed.plus(bondUsed);
  if(stockOrder.gt(0))legs.push({side:"BUY",sleeve:"STOCK",amount:money(stockOrder)});
  return {legs,targetGap:money(gap),residualGap:money(Decimal.max(0,gap.minus(stockOrder)))};
}
