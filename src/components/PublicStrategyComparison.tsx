"use client";

import {useMemo,useState} from "react";
import {CartesianGrid,Line,LineChart,ResponsiveContainer,Tooltip,XAxis,YAxis} from "recharts";
import {
  alignedWindow,chartRows,type PublicComparisonEntry,type PublicPeriod,type DatedValue
} from "@/domain/public-strategy-comparison";

type Props={entries:PublicComparisonEntry[];spy:DatedValue[];asOf:string;spySource:string|null};
const PERIODS:PublicPeriod[]=["1Y","3Y","5Y","10Y","ALL"];
const PALETTE=["#10a480","#347cfa","#ff9e3d","#9e64eb","#e65a70","#d2a127","#13a2ba","#729b53","#c56cb5","#648cca","#d87432","#73b9aa"];
const PREVIEW_COUNT=7;
function colorFor(entries:readonly PublicComparisonEntry[],key:string){
  const index=entries.findIndex(e=>e.key===key);
  return PALETTE[(index<0?0:index)%PALETTE.length];
}
function pct(value:number){return (value>=0?"+":"")+value.toFixed(1)+"%";}
function labelDate(date:string){
  const d=new Date(date+"T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(d);
}
function compactDate(date:string){
  const d=new Date(date+"T00:00:00Z");
  return new Intl.DateTimeFormat("en-GB",{month:"short",year:"2-digit",timeZone:"UTC"}).format(d);
}
function MiniTrend({points,color}:{points:{date:string;index:number}[];color:string}){
  if(points.length<2)return <span className="wm-compare-unavailable">—</span>;
  const series=points.length>60?points.filter((_,i)=>i===0||i===points.length-1||i%Math.ceil(points.length/60)===0):points;
  const values=series.map(p=>p.index),min=Math.min(...values),max=Math.max(...values);
  const span=Math.max(max-min,.001);
  const vertices=series.map((p,i)=>(i*78/Math.max(series.length-1,1)).toFixed(1)+","+(22-(p.index-min)*19/span).toFixed(1)).join(" ");
  return <svg className="wm-compare-spark" viewBox="0 0 80 25" role="img" aria-label="Recorded historical model trend"><polyline points={vertices} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export function PublicStrategyComparison({entries,spy,asOf,spySource}:Props){
  const [period,setPeriod]=useState<PublicPeriod>("ALL");
  const [search,setSearch]=useState("");
  const [sort,setSort]=useState<"catalogue"|"return">("catalogue");
  const [onlyReady,setOnlyReady]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [showSpy,setShowSpy]=useState(true);
  const [selected,setSelected]=useState<string[]>(()=>entries.filter(e=>e.available&&
    Boolean(alignedWindow(e.observations,spy,"ALL",asOf))).slice(0,3).map(e=>e.key));

  // The entire table, selected lines and chart use the same period state.
  // Columns show other horizons for comparison; the highlighted column and
  // chart always reflect the chosen period.
  const periodsByKey=useMemo(()=>new Map(entries.map(entry=>[
    entry.key,new Map(PERIODS.map(p=>[p,
      entry.available?alignedWindow(entry.observations,spy,p,asOf):null] as const))
  ] as const)),[entries,spy,asOf]);
  const spyWindows=useMemo(()=>new Map(PERIODS.map(p=>[p,alignedWindow(spy,spy,p,asOf)] as const)),
    [spy,asOf]);
  const metrics=useMemo(()=>new Map(entries.map(entry=>[entry.key,
    periodsByKey.get(entry.key)?.get(period)??null] as const)),[entries,periodsByKey,period]);
  const readyCount=entries.filter(e=>Boolean(metrics.get(e.key))).length;
  const matchingEntries=useMemo(()=>{
    const term=search.trim().toLowerCase();
    const found=entries.filter(entry=>(!term||entry.name.toLowerCase().includes(term)||
      entry.family.toLowerCase().includes(term))&&(!onlyReady||Boolean(metrics.get(entry.key))));
    if(sort==="return")found.sort((a,b)=>(metrics.get(b.key)?.model.percent??-Infinity)-
      (metrics.get(a.key)?.model.percent??-Infinity));
    return found;
  },[entries,metrics,search,sort,onlyReady]);
  const showAll=expanded||search.trim().length>0||onlyReady;
  const visibleEntries=showAll?matchingEntries:matchingEntries.slice(0,PREVIEW_COUNT);
  const hiddenCount=matchingEntries.length-visibleEntries.length;

  const active=entries.filter(entry=>selected.includes(entry.key)&&Boolean(metrics.get(entry.key)));
  const unavailableSelected=selected.filter(key=>!metrics.get(key));
  const rawChart=useMemo(()=>chartRows(active.map(entry=>({key:entry.key,points:entry.observations})),spy,period,asOf),
    [active,spy,period,asOf]);
  const chartData=useMemo(()=>{
    if(rawChart.length<=400)return rawChart;
    const stride=Math.ceil(rawChart.length/400);
    return rawChart.filter((row,i)=>i===0||i===rawChart.length-1||i%stride===0||active.some(entry=>typeof row[entry.key]==="number"));
  },[rawChart,active]);
  const changePeriod=(next:PublicPeriod)=>setPeriod(next);
  const toggle=(key:string)=>setSelected(old=>old.includes(key)?old.filter(x=>x!==key):[...old,key]);
  const benchmark=spyWindows.get(period);
  const benchmarkAsOf=benchmark?.spy.end??spy.at(-1)?.date??null;
  return <div className="wm-compare" aria-label="Historical strategy comparison">
    <div className="wm-compare-top wm-compare-table-heading">
      <div>
        <span className="wm-compare-eyebrow">COMPARE STRATEGIES</span>
        <h3>Choose the strategies you want to see.</h3>
        <p>Tick any strategy in the table to add its line to the overlapping chart below.</p>
      </div>
      <div className="wm-compare-periods" role="group" aria-label="Historical comparison period">
        {PERIODS.map(p=><button type="button" key={p} aria-pressed={period===p}
          className={period===p?"active":""} onClick={()=>changePeriod(p)}>
          {p==="ALL"?"All":p}</button>)}
      </div>
    </div>

    <div className="wm-compare-table-top">
      <div><strong>Strategy performance</strong><span>{entries.length} strategies · {readyCount} with verified {period==="ALL"?"available-history":period} returns</span></div>
      <div className="wm-compare-controls">
        <label className="wm-compare-search"><span className="sr-only">Search strategies</span>
          <input type="search" placeholder="Search all strategies…" value={search} onChange={e=>setSearch(e.target.value)}
            aria-label="Search strategies"/></label>
        <label className="wm-compare-filter"><input type="checkbox" checked={onlyReady} onChange={e=>setOnlyReady(e.target.checked)}/> With data</label>
        <label className="wm-compare-sort">Sort <select value={sort} onChange={e=>setSort(e.target.value as "catalogue"|"return")}>
          <option value="catalogue">Catalogue</option><option value="return">Return ({period==="ALL"?"all":period})</option>
        </select></label>
      </div>
    </div>

    <div id="wm-compare-table-rows" className="wm-compare-scroll" role="region" aria-label="Scrollable strategy performance table" tabIndex={0}>
      <table className="wm-compare-table">
        <thead><tr><th scope="col">Show</th><th scope="col">Strategy</th><th scope="col">Type</th>
          {PERIODS.map(p=><th scope="col" className={"number"+(p===period?" wm-compare-focused":"")} key={p}>{p==="ALL"?"All":p}</th>)}
          <th scope="col">Trend</th></tr></thead>
        <tbody>
          <tr className={"wm-compare-benchmark"+(showSpy?" wm-compare-active":"")}>
            <td><input type="checkbox" checked={showSpy} disabled={spy.length<2} onChange={e=>setShowSpy(e.target.checked)}
              aria-label="Show SPY buy and hold on chart"/></td>
            <th scope="row"><span className="wm-compare-dot" style={{background:"#8fa6c8"}}/>SPY (Buy &amp; Hold)</th>
            <td>Benchmark</td>
            {PERIODS.map(p=><td key={p} className={"number"+(p===period?" wm-compare-focused":"")}>{spyWindows.get(p)?pct(spyWindows.get(p)!.spy.percent):"—"}</td>)}
            <td>{benchmark?<MiniTrend points={benchmark.spy.points} color="#8fa6c8"/>:"—"}</td>
          </tr>
          {visibleEntries.map(entry=>{
            const window=metrics.get(entry.key);
            const activeSelected=selected.includes(entry.key);
            const comparable=Boolean(window);
            return <tr key={entry.key} className={activeSelected?"wm-compare-active":""}>
              <td><input type="checkbox" checked={activeSelected} disabled={!comparable}
                onChange={()=>toggle(entry.key)} aria-label={(activeSelected?"Hide ":"Show ")+entry.name+" on chart"}
                title={!comparable?"No verified history for this period":undefined}/></td>
              <th scope="row"><span className="wm-compare-dot" style={{background:colorFor(entries,entry.key)}}/>{entry.name}</th>
              <td>{entry.family}</td>
              {PERIODS.map(p=>{
                const result=periodsByKey.get(entry.key)?.get(p);
                return <td key={p} className={"number"+(p===period?" wm-compare-focused":"")+(result&&result.model.percent<0?" wm-negative":"")}>
                  {result?pct(result.model.percent):<span className="wm-compare-unavailable">—</span>}
                </td>;
              })}
              <td>{window?<MiniTrend points={window.model.points} color={colorFor(entries,entry.key)}/>:<span className="wm-compare-unavailable">Not verified</span>}</td>
            </tr>;
          })}
        </tbody>
      </table>
      {matchingEntries.length===0&&<p className="wm-compare-empty">No matching strategies. Clear the search or turn off the data filter.</p>}
    </div>

    <div className="wm-compare-table-footer">
      <span>{selected.length} selected · {visibleEntries.length} of {matchingEntries.length} strategies displayed</span>
      {!search.trim()&&!onlyReady&&matchingEntries.length>PREVIEW_COUNT&&
        <button type="button" className="wm-compare-more" onClick={()=>setExpanded(open=>!open)}
          aria-expanded={expanded} aria-controls="wm-compare-table-rows">
          {expanded?"Show fewer strategies":"Show more strategies ("+hiddenCount+" more)"} <span aria-hidden="true">{expanded?"↑":"↓"}</span>
        </button>}
    </div>

    <section id="wm-compare-chart-section" className="wm-compare-plot" aria-label="Overlapping strategy performance chart">
      <div className="wm-compare-chart-heading">
        <div><span className="wm-compare-eyebrow">HISTORICAL PERFORMANCE</span><h3>One chart. Your selected strategies.</h3>
          <p>{period==="ALL"?"All available comparable history":period+" return window"} · rebased to 100 at the same date</p></div>
        <div className="wm-compare-legend" role="group" aria-label="Selected chart lines">
          {showSpy&&spy.length>1&&<button type="button" className="wm-compare-legend-item" onClick={()=>setShowSpy(false)}
            aria-label="Hide SPY buy and hold on chart"><i style={{background:"#8fa6c8"}}/>SPY (Buy &amp; Hold) <span aria-hidden="true">×</span></button>}
          {active.map(entry=><button key={entry.key} type="button" className="wm-compare-legend-item"
            onClick={()=>toggle(entry.key)} aria-label={"Hide "+entry.name+" on chart"}>
            <i style={{background:colorFor(entries,entry.key)}}/>{entry.name}<span aria-hidden="true">×</span></button>)}
        </div>
      </div>
      {unavailableSelected.length>0&&<p className="wm-compare-chart-message" role="status">
        {unavailableSelected.length} previously selected strategy line(s) cannot be shown in this timeframe because comparable history is missing.
      </p>}
      {chartData.length>=2&&(showSpy||active.length>0)?<div className="wm-compare-chart" role="group" aria-label="Rebased historical return indices">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{top:12,left:1,right:13,bottom:4}}>
            <CartesianGrid stroke="#e3ebf7" strokeDasharray="3 5" vertical={false}/>
            <XAxis dataKey="date" tickFormatter={compactDate} tick={{fill:"#62748d",fontSize:11}}
              minTickGap={35} axisLine={false} tickLine={false}/>
            <YAxis domain={["auto","auto"]} width={52} tick={{fill:"#62748d",fontSize:11}}
              tickFormatter={(n:number)=>String(Math.round(n))} axisLine={false} tickLine={false}/>
            <Tooltip contentStyle={{background:"#ffffff",border:"1px solid #d2e0f2",color:"#172943",borderRadius:10}}
              labelFormatter={(label)=>labelDate(String(label))}
              formatter={(value,name)=>[typeof value==="number"?value.toFixed(2):String(value),String(name)]}/>
            {showSpy&&<Line type="linear" name="SPY · Buy & Hold" dataKey="SPY" stroke="#8fa6c8"
              strokeWidth={2.6} dot={false} connectNulls isAnimationActive={false}/>}
            {active.map(entry=><Line key={entry.key} type="linear" name={entry.name} dataKey={entry.key}
              stroke={colorFor(entries,entry.key)} strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false}/>)}
          </LineChart>
        </ResponsiveContainer>
      </div>:<div className="wm-compare-no-chart" role="status">
        <strong>{spy.length===0?"Licensed SPY data isn't published yet.":
          !showSpy&&active.length===0?"Select a strategy in the table above.":
          "No shared, verified performance history for this selection."}</strong>
        <span>{spy.length===0?"Performance will appear after licensed SPY and approved model returns are published.":
          "Try another period or select a strategy with available returns. Missing observations are never fabricated."}</span>
      </div>}
      <div className="wm-compare-caption">
        <span>Real documented model observations only · not a personal portfolio or return forecast</span>
        <span>{benchmarkAsOf?"SPY data through "+labelDate(benchmarkAsOf):"SPY data unavailable"}</span>
      </div>
    </section>
    <p className="wm-compare-disclosure">Historical <em>model</em> results, not actual investor returns or predictions. Each strategy is compared with adjusted USD SPY buy-and-hold on verified matching observation dates. Missing observations are not interpolated into performance data; lines visually connect recorded points. Historical models require attested methodology, licensing, fee and cash-flow treatment. Unverified results and unsupported periods display no return. Listed strategies may not be available to start in your country. Leveraged investments can suffer substantial losses. {spySource?"SPY source: "+spySource+". ":""}Past performance does not predict future results.</p>
  </div>;
}
