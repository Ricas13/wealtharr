"use client";
import Link from "next/link";
import {Cell,Pie,PieChart,ResponsiveContainer,Tooltip} from "recharts";
import type {PortfolioAllocation} from "@/domain/portfolio-allocation-view";

const colors=["#4e83e1","#4cc6d8","#6156bd","#ab63e5","#23a3a2","#e2aa59","#e38199","#7191a8"];
const money=(value:number,currency:string)=>new Intl.NumberFormat("en-GB",{style:"currency",currency,maximumFractionDigits:0}).format(value);

export function PortfolioAllocationChart({allocation}:{allocation:PortfolioAllocation|null}){
 if(!allocation)return <div className="portfolio-allocation-empty">
   <strong>Allocation will appear here</strong>
   <p>We need a recorded value for every open strategy in one currency. No currency conversions or missing balances are estimated.</p>
   <Link href="/app/strategies" className="portfolio-panel-link">Review your strategies →</Link>
 </div>;
 return <div className="portfolio-allocation-widget">
  <div className="portfolio-allocation-visual" role="img" aria-label={"Allocation across "+allocation.items.length+" strategies. "+allocation.items.map(item=>item.name+" "+item.sharePct.toFixed(1)+" percent").join(", ")}>
   <ResponsiveContainer width="100%" height={220}>
    <PieChart><Pie data={allocation.items} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={67} outerRadius={96} paddingAngle={allocation.items.length>1?2:0} stroke="none" isAnimationActive={false}>
      {allocation.items.map((item,i)=><Cell key={item.id} fill={colors[i%colors.length]}/>)}
    </Pie><Tooltip formatter={(value)=>money(Number(value),allocation.currency)}/></PieChart>
   </ResponsiveContainer>
   <div className="portfolio-allocation-center" aria-hidden="true"><small>Observed value</small><strong>{money(allocation.total,allocation.currency)}</strong></div>
  </div>
  <div className="portfolio-allocation-legend">
   {allocation.items.map((item,i)=><div className="portfolio-allocation-legend-row" key={item.id}>
     <span className="portfolio-allocation-swatch" style={{background:colors[i%colors.length]}} aria-hidden="true"/>
     <span className="portfolio-allocation-legend-name">{item.name}</span>
     <strong>{item.sharePct.toFixed(1)}%</strong>
    </div>)}
  </div>
 </div>;
}
