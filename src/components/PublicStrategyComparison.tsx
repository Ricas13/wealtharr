"use client";

import {useMemo,useState} from "react";
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {
  alignedWindow,chartRows,type PublicComparisonEntry,type PublicPeriod,type DatedValue
} from "@/domain/public-strategy-comparison";

type Props={entries:PublicComparisonEntry[];spy:DatedValue[];asOf:string;spySource:string|null};
const PERIODS:PublicPeriod[]=["1Y","3Y","5Y","ALL"];
const COLORS=["#b7f5cc","#95b9e8","#e9bd82","#bca9e8","#71cbb7","#e898a3","#9dc4df","#ebd58a"];
const MAX_SELECTED=8;
function pct(value:number){return (value>=0?"+":"")+value.toFixed(1)+"%";}
function labelDate(date:string){
  const d=new Date(date+"T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(d);
}
function compactDate(date:string){
  const d=new Date(date+"T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB",{month:"short",year:"2-digit",timeZone:"UTC"}).format(d);
}
export function PublicStrategyComparison({entries,spy,asOf,spySource}:Props){
  const [period,setPeriod]=useState<PublicPeriod>("1Y");
  const [search,setSearch]=useState("");
  const [sort,setSort]=useState<"catalogue"|"return">("catalogue");
  const [onlyReady,setOnlyReady]=useState(false);
  const [selected,setSelected]=useState<string[]>(()=>entries.filter(e=>e.available).slice(0,3).map(e=>e.key));
  const benchmark=useMemo(()=>alignedWindow(spy,spy,period,asOf),[spy,period,asOf]);
  const metrics=useMemo(()=>new Map(entries.map(entry=>[
    entry.key,entry.available?alignedWindow(entry.observations,spy,period,asOf):null
  ] as const)),[entries,spy,period,asOf]);
  const visibleEntries=useMemo(()=>{
    const term=search.trim().toLowerCase();
    const found=entries.filter(entry=>(!term||entry.name.toLowerCase().includes(term)||
      entry.family.toLowerCase().includes(term))&&(!onlyReady||Boolean(metrics.get(entry.key))));
    if(sort==="return")found.sort((a,b)=>(metrics.get(b.key)?.model.percent??-Infinity)-
      (metrics.get(a.key)?.model.percent??-Infinity));
    return found;
  },[entries,metrics,search,sort,onlyReady]);
  const active=entries.filter(entry=>selected.includes(entry.key)&&Boolean(metrics.get(entry.key)));
  const rawChart=useMemo(()=>chartRows(active.map(entry=>({key:entry.key,points:entry.observations})),spy,period,asOf),
    [active,spy,period,asOf]);
  const chartData=useMemo(()=>{
    if(rawChart.length<=200)return rawChart;
    const stride=Math.ceil(rawChart.length/200);
    return rawChart.filter((_,i)=>i===0||i===rawChart.length-1||i%stride===0);
  },[rawChart]);
  const toggle=(key:string)=>{
    setSelected(old=>old.includes(key)?old.filter(x=>x!==key):
      old.length>=MAX_SELECTED?old:[...old,key]);
  };
  const allReady=entries.filter(e=>e.available&&Boolean(metrics.get(e.key)));
  const benchmarkAsOf=benchmark?.spy.end??spy.at(-1)?.date??null;
  return <div className="wm-compare" aria-label="Historical strategy comparison">
    <div className="wm-compare-top">
      <div>
        <span className="wm-compare-eyebrow">PERFORMANCE EXPLORER</span>
        <h3>Compare strategies with SPY.</h3>
        <p>Select a strategy to add or remove it from the chart. The SPY buy-and-hold benchmark stays visible.</p>
      </div>
      <div className="wm-compare-periods" role="group" aria-label="Historical comparison period">
        {PERIODS.map(p=><button type="button" key={p} aria-pressed={period===p}
          className={period===p?"active":""} onClick={()=>setPeriod(p)}>{p==="ALL"?"Available history":p}</button>)}
      </div>
    </div>
    <div className="wm-compare-plot" aria-label="Interactive historical strategy performance chart">
      <div className="wm-compare-legend"><span className="wm-compare-spy"><i/>SPY · buy &amp; hold</span>
        {active.map((entry,i)=><button key={entry.key} onClick={()=>toggle(entry.key)} type="button"
          title={"Hide "+entry.name} className="wm-compare-legend-item">
          <i style={{background:COLORS[i%COLORS.length]}}/>{entry.name}<span aria-hidden="true">×</span>
        </button>)}
      </div>
      {chartData.length>=2?<div className="wm-compare-chart" role="group" aria-label="Rebased historical return indices">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{top:12,left:0,right:20,bottom:4}}>
            <CartesianGrid stroke="#2e4348" strokeDasharray="3 5" vertical={false}/>
            <XAxis dataKey="date" tickFormatter={compactDate} tick={{fill:"#a8babb",fontSize:11}}
              minTickGap={35} axisLine={false} tickLine={false}/>
            <YAxis domain={["auto","auto"]} width={48} tick={{fill:"#a8babb",fontSize:11}}
              tickFormatter={(n:number)=>String(Math.round(n))} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:"#152126",border:"1px solid #49616a",color:"#f1f7f3",borderRadius:10}}
              labelFormatter={(label)=>labelDate(String(label))}
              formatter={(value,name)=>[typeof value==="number"?value.toFixed(2):String(value),String(name)]}/>
            <Line type="linear" name="SPY · buy & hold" dataKey="SPY" stroke="#eaf3fc"
              strokeWidth={2.8} dot={false} isAnimationActive={false}/>
            {active.map((entry,i)=><Line key={entry.key} type="linear" name={entry.name} dataKey={entry.key}
              stroke={COLORS[i%COLORS.length]} strokeWidth={2.2} dot={false} isAnimationActive={false}/>)}
          </LineChart>
        </ResponsiveContainer>
      </div>:<div className="wm-compare-no-chart" role="status">
        <strong>{spy.length===0?"Licensed SPY data isn't published yet.":selected.length===0?"Choose a strategy to compare.":"No shared verified history for this selection."}</strong>
        <span>{spy.length===0?"The strategy catalogue is visible below. Returns will appear only after approved model and SPY total-return data are supplied.":"Select a strategy with available history or try a different period. We never fill gaps with invented prices."}</span>
      </div>}
      <div className="wm-compare-caption">
        <span>Rebased index: 100 at the same starting observation · not a £ portfolio balance</span>
        <span>{benchmarkAsOf?"Latest SPY observation: "+labelDate(benchmarkAsOf):"SPY data unavailable"}</span>
      </div>
    </div>
    <div className="wm-compare-table-top">
      <div><strong>Strategy comparison</strong><span>{entries.length} methods in the catalogue · {allReady.length} with comparable {period==="ALL"?"available":period} history</span></div>
      <div className="wm-compare-controls">
        <label className="wm-compare-search"><span className="sr-only">Search strategies</span>
          <input type="search" placeholder="Find a strategy" value={search} onChange={e=>setSearch(e.target.value)}
            aria-label="Search strategies"/></label>
        <label className="wm-compare-filter"><input type="checkbox" checked={onlyReady} onChange={e=>setOnlyReady(e.target.checked)}/> With data</label>
        <label className="wm-compare-sort">Sort <select value={sort} onChange={e=>setSort(e.target.value as "catalogue"|"return")}>
          <option value="catalogue">Catalogue</option><option value="return">Return</option>
        </select></label>
      </div>
    </div>
    <div className="wm-compare-scroll" role="region" aria-label="Scrollable strategy performance table" tabIndex={0}>
      <table className="wm-compare-table">
        <thead><tr><th scope="col">Compare</th><th scope="col">Method</th><th scope="col">Approach</th>
          <th scope="col" className="number">Return</th><th scope="col" className="number">vs SPY</th><th scope="col">Through</th></tr></thead>
        <tbody>
          <tr className="wm-compare-benchmark"><td><span aria-label="SPY benchmark always shown" className="wm-compare-pinned">Pinned</span></td>
            <th scope="row">SPY · Buy &amp; hold</th><td>US large-cap equity ETF</td>
            <td className="number">{benchmark?pct(benchmark.spy.percent):"—"}</td>
            <td className="number">Baseline</td><td>{benchmarkAsOf?labelDate(benchmarkAsOf):"Awaiting verified data"}</td></tr>
          {visibleEntries.map(entry=>{
            const window=metrics.get(entry.key);
            const activeSelected=selected.includes(entry.key);
            const comparable=Boolean(window);
            const comparison=window?window.model.percent-window.spy.percent:null;
            return <tr key={entry.key} className={activeSelected?"wm-compare-active":""}>
              <td><input type="checkbox" checked={activeSelected} disabled={!comparable||(!activeSelected&&selected.length>=MAX_SELECTED)}
                onChange={()=>toggle(entry.key)} aria-label={(activeSelected?"Hide ":"Show ")+entry.name+" on chart"}/></td>
              <th scope="row">{entry.name}</th><td>{entry.family}</td>
              <td className={"number "+(window&&window.model.percent<0?"wm-negative":"")}>{window?pct(window.model.percent):<span className="wm-compare-unavailable">Not verified</span>}</td>
              <td className="number">{comparison===null?"—":pct(comparison)+" pp"}</td>
              <td>{window?labelDate(window.model.end):<span className="wm-compare-unavailable">{entry.reason}</span>}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {visibleEntries.length===0&&<p className="wm-compare-empty">No matching strategies. Clear the search or turn off the data filter.</p>}
    </div>
    <p className="wm-compare-disclosure">Historical *model* results, not actual investor returns or predictions. Each strategy is compared with adjusted USD SPY buy-and-hold on identical observation dates. Series require operator-attested methodology, licence and fee/cash-flow treatment; gaps, unpublished models and unsupported periods show no return. Strategies listed here are not necessarily enabled or available in your country. Leveraged investments can suffer substantial losses. {spySource?"SPY data source: "+spySource+". ":""}Past performance does not predict future results.</p>
  </div>;
}
