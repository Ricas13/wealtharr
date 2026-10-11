import Link from "next/link";
import {ArrowRight,Plus} from "lucide-react";
import {requirePageUser} from "@/lib/session";
import {listUserStrategies} from "@/lib/strategy-service";
import {sql} from "@/lib/db";
import {PortfolioAllocationChart} from "@/components/PortfolioAllocationChart";
import {portfolioAllocationBreakdown} from "@/domain/portfolio-allocation-view";

function state(strategy:any){
 if(strategy.status==="CLOSED")return {className:"is-attention",label:"Closed"};
 if(strategy.status==="PAUSED")return {className:"is-attention",label:"Paused"};
 return strategy.health_status==="HEALTHY"
   ?{className:"is-healthy",label:"On track"}:{className:"is-attention",label:"Needs attention"};
}

export default async function StrategiesPage(){
 const user=await requirePageUser();
 const rows=await listUserStrategies(user.id);
 const active=rows.filter((s:any)=>s.status==="ACTIVE").length;
 const paused=rows.filter((s:any)=>s.status==="PAUSED").length;
 const closed=rows.filter((s:any)=>s.status==="CLOSED").length;
 const valuationRows=await sql.unsafe("SELECT ps.strategy_instance_id,ps.value,a.currency FROM performance_series ps JOIN strategy_instances i ON i.id=ps.strategy_instance_id JOIN accounts a ON a.id=i.account_id WHERE i.user_id=$1 AND i.status<>'CLOSED' AND ps.series_type='USER_VALUE' AND ps.date=(SELECT max(p2.date) FROM performance_series p2 WHERE p2.strategy_instance_id=ps.strategy_instance_id AND p2.series_type='USER_VALUE')",[user.id]);
 const tracked=rows.filter((s:any)=>s.status!=="CLOSED");
 const allocation=portfolioAllocationBreakdown(
  tracked.map((s:any)=>({id:String(s.id),name:String(s.name)})),
  valuationRows.map((v:any)=>({strategy_instance_id:String(v.strategy_instance_id),value:v.value,currency:String(v.currency)}))
 );
 return <div className="portfolio-strategies-workspace">
  <div className="portfolio-page-heading"><div><div className="eyebrow">PORTFOLIO / STRATEGIES</div>
   <h1>My strategies</h1><p>All your tracked investing methods and accounts in one organised view.</p></div>
   <Link href="/app/strategies/new" className="button primary"><Plus size={16}/>Add strategy</Link>
  </div>
  <div className="portfolio-secondary-kpis" aria-label="Strategy counts">
   <div><span>Total strategies</span><strong>{rows.length}</strong></div>
   <div><span>Active</span><strong>{active}</strong></div>
   <div><span>Paused</span><strong>{paused}</strong></div>
   <div><span>Closed history</span><strong>{closed}</strong></div>
  </div>
  {rows.length>0&&<section className="portfolio-panel portfolio-composition-panel" aria-label="Allocation by strategy">
   <div className="portfolio-panel-heading"><div><h2>Allocation by strategy</h2><p>Share of recorded account values, shown only when every tracked strategy has a valuation in the same currency.</p></div></div>
   <PortfolioAllocationChart allocation={allocation}/>
  </section>}
  <section className="portfolio-panel portfolio-holdings-panel">
   <div className="portfolio-panel-heading"><div><h2>All strategies</h2>
    <p>Select a strategy to see its holdings, observed performance, calculations and action history.</p></div>
    <Link className="portfolio-panel-link" href="/app">Dashboard <ArrowRight size={14}/></Link>
   </div>
   {rows.length?<div className="portfolio-table-wrap" role="region" tabIndex={0} aria-label="All tracked strategies">
     <table className="portfolio-data-table"><thead><tr><th scope="col">Strategy</th><th scope="col">Investment method</th>
     <th scope="col">Account</th><th scope="col">Version</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Open</span></th></tr></thead>
     <tbody>{rows.map((s:any)=>{const indicator=state(s);return <tr key={String(s.id)}>
      <td><Link className="portfolio-row-title" href={"/app/strategies/"+s.id}>{s.name}</Link><small>{s.currency}</small></td>
      <td>{s.strategy_name}</td>
      <td>{s.wrapper}<small>{s.broker_name??"Broker not specified"}</small></td>
      <td>v{s.version}</td>
      <td><span className={"portfolio-status "+indicator.className}>{indicator.label}</span></td>
      <td><Link className="portfolio-row-arrow" href={"/app/strategies/"+s.id} aria-label={"Open "+s.name}><ArrowRight size={16}/></Link></td>
     </tr>;})}</tbody></table>
    </div>:<div className="portfolio-allocation-empty"><strong>No strategies yet</strong><p>Create your first strategy to start recording contributions and monitoring rebalances.</p><Link className="button primary" href="/app/strategies/new"><Plus size={15}/>Add first strategy</Link></div>}
  </section>
  <p className="portfolio-chart-footnote">Wealtharr uses only your recorded positions and verified quotes. Market prices, currency conversions and strategy performance are never assumed from a strategy name.</p>
 </div>;
}
