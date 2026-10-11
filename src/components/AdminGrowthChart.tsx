/** Server-rendered, observation-backed SVG. We deliberately do not invent revenue. */
type Point={month:string;customers:number;strategies:number};
export function AdminGrowthChart({points}:{points:Point[]}){
 const max=Math.max(1,...points.flatMap(p=>[p.customers,p.strategies]));
 const at=(i:number,v:number)=>({x:16+i*320/Math.max(1,points.length-1),y:120-(v/max)*91});
 const path=(key:"customers"|"strategies")=>points.map((p,i)=>{
  const {x,y}=at(i,p[key]);return (i?"L":"M")+x.toFixed(1)+","+y.toFixed(1);
 }).join(" ");
 const total=points.reduce((n,p)=>n+p.customers,0);
 return <section className="admin-design-panel admin-growth-panel" aria-labelledby="admin-growth-title">
  <header className="admin-design-panel-header">
   <div><h2 id="admin-growth-title">Revenue & growth</h2><p>Observed customer and strategy registrations · last 6 months</p></div>
   <span className="admin-chart-period">6 months</span>
  </header>
  <div className="admin-chart-legend">
   <span><i className="admin-legend-mark customers"/> Customers</span>
   <span><i className="admin-legend-mark strategies"/> Strategies</span>
  </div>
  <svg viewBox="0 0 352 149" role="img" aria-label={"New customer registrations over six months: "+total+". Registration values are observed; revenue unavailable until verified billing data exists."} className="admin-growth-svg" preserveAspectRatio="none">
   {[29,59,89,120].map(y=><line key={y} x1="16" y1={y} x2="336" y2={y} stroke="currentColor" opacity=".12" strokeDasharray="4 5"/>)}
   {points.length>1&&<><path d={path("customers")} fill="none" stroke="#688FE8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
     <path d={path("strategies")} fill="none" stroke="#60C5B0" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></>}
   {points.map((p,i)=><g key={p.month}>
    <circle cx={at(i,p.customers).x} cy={at(i,p.customers).y} r="3" fill="#688FE8"/>
    <text x={at(i,0).x} y="144" fontSize="9.5" textAnchor="middle" fill="currentColor" opacity=".8">{p.month}</text>
   </g>)}
  </svg>
  <p className="admin-data-caveat">{total===0?"No registrations yet. The chart will populate as real customers join.":"Counts come from recorded account and strategy creation timestamps."} Financial revenue is not estimated from list prices.</p>
 </section>;
}
