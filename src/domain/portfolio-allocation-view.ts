/** Display-only portfolio composition. Never infer a consolidated value across currencies. */
export type AllocationItem={id:string;name:string;value:number;sharePct:number};
export type PortfolioAllocation={currency:string;total:number;items:AllocationItem[]};
export type ValuationRow={strategy_instance_id:string;value:unknown;currency:string};

export function portfolioAllocationBreakdown(
 strategies:readonly {id:string;name:string}[],
 valuations:readonly ValuationRow[]
):PortfolioAllocation|null{
 if(!strategies.length||!valuations.length)return null;
 const byStrategy=new Map<string,ValuationRow>();
 for(const row of valuations){
  if(byStrategy.has(String(row.strategy_instance_id)))return null;
  byStrategy.set(String(row.strategy_instance_id),row);
 }
 if(byStrategy.size!==strategies.length)return null;
 const currencies=new Set<string>();
 const data:{id:string;name:string;value:number}[]=[];
 for(const strategy of strategies){
  const row=byStrategy.get(String(strategy.id));
  if(!row)return null;
  const value=Number(row.value);
  if(row.value===null||row.value===undefined||!Number.isFinite(value)||value<0)return null;
  currencies.add(String(row.currency).toUpperCase());
  data.push({id:String(strategy.id),name:String(strategy.name),value});
 }
 if(currencies.size!==1)return null;
 const currency=[...currencies][0];
 if(!/^[A-Z]{3}$/.test(currency))return null;
 const total=data.reduce((sum,item)=>sum+item.value,0);
 if(!Number.isFinite(total)||total<=0)return null;
 return {currency,total,items:data.map(item=>({...item,sharePct:item.value/total*100}))};
}
