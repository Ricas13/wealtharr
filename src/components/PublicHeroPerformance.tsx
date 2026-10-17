"use client";
import {useMemo} from "react";
import {Line,LineChart,ResponsiveContainer,Tooltip,XAxis} from "recharts";
import {alignedWindow,chartRows,type PublicComparisonEntry,type DatedValue} from "@/domain/public-strategy-comparison";
type Props={entries:PublicComparisonEntry[];spy:DatedValue[];asOf:string};
function formatDate(s:string){return new Intl.DateTimeFormat("en-GB",{month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(s+"T00:00:00Z"));}
function signed(v:number){return (v>=0?"+":"")+v.toFixed(1)+"%";}
export function PublicHeroPerformance({entries,spy,asOf}:Props){
  const featured=entries.find(entry=>entry.available&&Boolean(alignedWindow(entry.observations,spy,"ALL",asOf)));
  const pair=featured?alignedWindow(featured.observations,spy,"ALL",asOf):null;
  const raw=useMemo(()=>featured?chartRows([{key:featured.key,points:featured.observations}],spy,"ALL",asOf):[],
    [featured,spy,asOf]);
  const chart=raw.length>100?raw.filter((row,i)=>i===0||i===raw.length-1||i%Math.ceil(raw.length/100)===0||typeof row[featured!.key]==="number"):raw;
  return <div className="wm-hero-evidence" aria-label="Verified historical model comparison preview">
    <div className="wm-hero-evidence-head"><strong>Strategy performance</strong><span>Historical model vs SPY</span></div>
    {featured&&pair&&chart.length>=2?<div className="wm-hero-evidence-data">
      <div className="wm-hero-evidence-stats">
        <div><small><i className="wm-hero-color-model"/>{featured.name}</small><strong>{signed(pair.model.percent)}</strong></div>
        <div><small><i className="wm-hero-color-spy"/>SPY buy &amp; hold</small><strong>{signed(pair.spy.percent)}</strong></div>
      </div>
      <div className="wm-hero-evidence-chart" role="group" aria-label="Recorded historical model versus SPY comparison">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart} margin={{left:0,right:4,top:6,bottom:3}}>
            <XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={48} tickFormatter={formatDate}
              tick={{fill:"#72859b",fontSize:10}}/>
            <Tooltip labelFormatter={v=>formatDate(String(v))}
              formatter={(v,name)=>[typeof v==="number"?v.toFixed(1):String(v),String(name)]}/>
            <Line dataKey="SPY" name="SPY buy & hold" dot={false} type="linear" stroke="#90a5c3"
              strokeWidth={2} connectNulls isAnimationActive={false}/>
            <Line dataKey={featured.key} name={featured.name} dot={false} type="linear" stroke="#0b9a74"
              strokeWidth={3} connectNulls isAnimationActive={false}/>
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="wm-hero-evidence-note">Historical total-return indices · {pair.model.start} to {pair.model.end} · not a forecast</p>
    </div>:<div className="wm-hero-evidence-unavailable">
      <span className="wm-hero-evidence-icon" aria-hidden="true">↗</span>
      <strong>Compare strategies on equal terms.</strong>
      <p>See verified historical strategy results alongside SPY, with no invented performance figures.</p>
      <span>Awaiting approved comparable data</span>
    </div>}
    <a href="#compare" className="wm-hero-evidence-foot">
      <span aria-hidden="true">↗</span><strong>Explore all the strategies</strong><span>Compare models and choose what to follow →</span>
    </a>
  </div>;
}