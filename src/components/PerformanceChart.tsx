"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { rebaseIndexedWindow, periodCutoffIso } from "@/domain/chart-window";
import { money } from "@/lib/format";

type Point={
  date:string;
  actual?:number;
  model?:number;
  benchmark?:number;
  benchmarkValues?:Record<string,number>;
};
type Marker={date:string;type:"CONTRIBUTION"|"REVIEW";label:string};
type ComparisonSeries={key:string;label:string;defaultVisible?:boolean};
const frames=["1M","3M","6M","YTD","1Y","3Y","5Y","MAX"];
const fullFrames=["1D","1W","1M","3M","6M","YTD","1Y","3Y","5Y","ALL","CUSTOM"];
const comparisonColors=["var(--chart-comparison-1)","var(--chart-comparison-2)","var(--chart-comparison-3)","var(--chart-comparison-4)","var(--chart-comparison-5)","var(--chart-comparison-6)"];
const DAY_MS=86_400_000;
const FULL_DATE:Intl.DateTimeFormatOptions={day:"numeric",month:"short",year:"numeric"};

function compact(value:number){
  return new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:1}).format(value);
}

function parseDay(value:string){
  const date=new Date(value.length===10?value+"T00:00:00Z":value);
  return Number.isFinite(date.getTime())?date:null;
}

// Chart dates are calendar days, so they are formatted in UTC and never shift with the viewer's zone.
function formatDay(value:string,options:Intl.DateTimeFormatOptions){
  const date=parseDay(value);
  return date?new Intl.DateTimeFormat("en-GB",{...options,timeZone:"UTC"}).format(date):value;
}

function plainNumber(value:number){
  return new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(value);
}

export function PerformanceChart({
  data,markers=[],comparisons=[],actualLabel="Your portfolio",indexed=false,fullControls=false,currency,pinnedAppearance=false
}:{
  data:Point[];
  markers?:Marker[];
  comparisons?:ComparisonSeries[];
  actualLabel?:string;
  indexed?:boolean;
  fullControls?:boolean;
  /** Currency of the plotted values; adds a unit to the tooltip and table figures. */
  currency?:string;
  /**
   * Keeps the original axis labels and curve and omits the data table. Only the public demo sets
   * this: its rendered page is pixel-hash pinned, so its look changes together with a regenerated
   * baseline and not before.
   */
  pinnedAppearance?:boolean;
}) {
  const gradientId=("actual-"+useId()).replaceAll(":","");
  const hasActual=data.some((point)=>point.actual!=null);
  const hasModel=data.some((point)=>point.model!=null);
  const hasLegacyBenchmark=data.some((point)=>point.benchmark!=null);
  const availableComparisons=useMemo(
    ()=>comparisons.length
      ?comparisons
      :hasLegacyBenchmark?[{key:"legacy-benchmark",label:"Benchmark",defaultVisible:!hasActual&&!hasModel}]:[],
    [comparisons,hasLegacyBenchmark,hasActual,hasModel]
  );
  const [frame,setFrame]=useState(fullControls?"ALL":"MAX");
  const [customStart,setCustomStart]=useState("");
  const [customEnd,setCustomEnd]=useState("");
  const latestDate=useMemo(()=>[...data].sort((a,b)=>a.date.localeCompare(b.date)).at(-1)?.date??"",[data]);
  const [showActual,setShowActual]=useState(hasActual);
  const [showModel,setShowModel]=useState(!hasActual&&hasModel);
  const [visibleComparisons,setVisibleComparisons]=useState<Record<string,boolean>>(
    ()=>Object.fromEntries(availableComparisons.map((series)=>[series.key,Boolean(series.defaultVisible)]))
  );
  const [reduceMotion,setReduceMotion]=useState(false);
  const [tableOpen,setTableOpen]=useState(false);
  // Straight segments between observations: a smoothed curve would draw values that were never recorded.
  const areaType=pinnedAppearance?"monotone":"linear";

  useEffect(()=>{
    const media=window.matchMedia("(prefers-reduced-motion: reduce)");
    const update=()=>setReduceMotion(media.matches);
    update();
    media.addEventListener("change",update);
    return ()=>media.removeEventListener("change",update);
  },[]);

  const filtered=useMemo(()=>{
    const min=periodCutoffIso(frame,latestDate);
    return data.filter(point=>(frame!=="CUSTOM"||(!customStart||point.date>=customStart)&&(!customEnd||point.date<=customEnd))&&
      (frame==="CUSTOM"||!min||point.date>=min));
  },[data,frame,latestDate,customStart,customEnd]);
  // Period returns must start at 100 *within the selected window*, not inherit the
  // strategy's lifetime baseline. A comparison without the first-date quote is
  // withheld instead of rebasing on a later date and fabricating a fair start.
  const chartData=useMemo(()=>indexed?rebaseIndexedWindow(filtered):filtered,[filtered,indexed]);
  const filteredMarkers=useMemo(()=>{
    const dates=new Set(filtered.map(point=>point.date));
    return markers.filter(marker=>dates.has(marker.date));
  },[markers,filtered]);
  const axisOptions=useMemo<Intl.DateTimeFormatOptions>(()=>{
    const times=chartData.map((point)=>parseDay(point.date)?.getTime()).filter((value):value is number=>value!==undefined);
    const span=times.length?(Math.max(...times)-Math.min(...times))/DAY_MS:0;
    return span>400?{month:"short",year:"2-digit"}:{day:"numeric",month:"short"};
  },[chartData]);

  if(!data.length) return <div className="empty">Performance appears here once the strategy has enough valued history.</div>;

  const formatValue=(value:number)=>currency?money(value,currency):indexed?"Index "+plainNumber(value):plainNumber(value);
  const tableSeries:Array<{key:string;label:string;read:(point:Point)=>number|undefined}>=[];
  if(showActual&&hasActual)tableSeries.push({key:"actual",label:actualLabel,read:(point)=>point.actual});
  if(showModel&&hasModel)tableSeries.push({key:"model",label:"Strategy model",read:(point)=>point.model});
  availableComparisons.forEach((series)=>{
    if(visibleComparisons[series.key])tableSeries.push({key:series.key,label:series.label,read:(point)=>series.key==="legacy-benchmark"?point.benchmark:point.benchmarkValues?.[series.key]});
  });

  return <div className="performance-chart">
    <div className="chart-toolbar">
      <div className="timeframes" role="group" aria-label="Chart timeframe">{(fullControls?fullFrames:frames).map((f)=><button type="button" key={f} className={"timeframe "+(frame===f?"active":"")} aria-pressed={frame===f} onClick={()=>setFrame(f)}>{f}</button>)}</div>
      {frame==="CUSTOM"&&<div className="chart-date-range"><span>From <input aria-label="Chart custom start date" type="date" max={customEnd||latestDate} value={customStart} onChange={event=>setCustomStart(event.target.value)}/></span><span>To <input aria-label="Chart custom end date" type="date" min={customStart||undefined} max={latestDate} value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></span></div>}
      <div className="series-toggles" role="group" aria-label="Chart comparisons">
        {hasActual&&<button type="button" className={"series-chip actual "+(showActual?"active":"")} aria-pressed={showActual} onClick={()=>setShowActual(!showActual)}><span/>{actualLabel}</button>}
        {hasModel&&<button type="button" className={"series-chip model "+(showModel?"active":"")} aria-pressed={showModel} onClick={()=>setShowModel(!showModel)}><span/>Strategy model</button>}
        {availableComparisons.map((series,index)=>{
          const active=Boolean(visibleComparisons[series.key]);
          return <button
            type="button"
            key={series.key}
            className={"series-chip benchmark "+(active?"active":"")}
            aria-pressed={active}
            onClick={()=>setVisibleComparisons((current)=>({...current,[series.key]:!current[series.key]}))}
          ><span style={{background:comparisonColors[index%comparisonColors.length]}}/>{series.label}</button>;
        })}
      </div>
    </div>
    {indexed&&<p className="help">Flow-adjusted index, rebased to 100 at the first observed date in this selected period. Comparison lines need a quote on that same date. This is an estimate, not exact time-weighted performance.</p>}
    {frame==="1D"&&<p className="help">One-day comparisons use the last two dated snapshots where available. Intraday moves cannot be shown from daily values.</p>}
    {!filtered.length&&<p className="help">No verified values in this date range.</p>}
    {filteredMarkers.length>0&&<div className="chart-markers" role="group" aria-label="Chart event markers"><span className="chart-marker-key contribution">+ Contributions</span><span className="chart-marker-key review">R Reviews</span></div>}
    <div className="chart-wrap" role="group" aria-label="Performance chart"><ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{top:22,right:8,left:0,bottom:0}} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-actual)" stopOpacity={.28}/><stop offset="100%" stopColor="var(--chart-actual)" stopOpacity={0}/></linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
        <XAxis dataKey="date" tick={{fill:"var(--chart-axis)",fontSize:10}} axisLine={false} tickLine={false} minTickGap={30} tickFormatter={pinnedAppearance?undefined:(value)=>formatDay(String(value),axisOptions)}/>
        <YAxis tick={{fill:"var(--chart-axis)",fontSize:10}} tickFormatter={(v)=>compact(Number(v))} axisLine={false} tickLine={false} width={48}/>
        {filteredMarkers.map((marker,index)=><ReferenceLine key={marker.type+marker.date+index} x={marker.date} stroke={marker.type==="CONTRIBUTION"?"var(--chart-model)":"var(--chart-comparison-1)"} strokeOpacity={.42} strokeDasharray="3 5" label={{value:marker.type==="CONTRIBUTION"?"+":"R",position:"insideTop",fill:marker.type==="CONTRIBUTION"?"var(--chart-model)":"var(--chart-comparison-1)",fontSize:10}} ifOverflow="extendDomain"/>)}
        <Tooltip
          contentStyle={{background:"var(--chart-tooltip-bg)",border:"1px solid var(--line)",borderRadius:14,boxShadow:"var(--shadow)",color:"var(--text)"}}
          labelStyle={{color:"var(--muted)",fontSize:11}}
          itemStyle={{fontSize:12}}
          labelFormatter={pinnedAppearance?undefined:(label)=>formatDay(String(label),FULL_DATE)}
          formatter={(value,name)=>[formatValue(Number(value)),String(name)]}
        />
        {showActual&&<Area type={areaType} dataKey="actual" name={actualLabel} stroke="var(--chart-actual)" fill={"url(#"+gradientId+")"} strokeWidth={3} connectNulls isAnimationActive={!reduceMotion} animationDuration={650}/>}
        {showModel&&<Area type={areaType} dataKey="model" name="Strategy model" stroke="var(--chart-model)" fillOpacity={0} strokeWidth={2.25} connectNulls isAnimationActive={!reduceMotion} animationDuration={650}/>}
        {availableComparisons.map((series,index)=>visibleComparisons[series.key]&&<Area
          key={series.key}
          type={areaType}
          dataKey={(point:Point)=>series.key==="legacy-benchmark"?point.benchmark:point.benchmarkValues?.[series.key]}
          name={series.label}
          stroke={comparisonColors[index%comparisonColors.length]}
          fillOpacity={0}
          strokeWidth={2}
          connectNulls
          isAnimationActive={!reduceMotion}
          animationDuration={650}
        />)}
      </AreaChart>
    </ResponsiveContainer></div>
    {!pinnedAppearance&&tableSeries.length>0&&chartData.length>0&&<details className="chart-table-toggle" onToggle={(event)=>setTableOpen(event.currentTarget.open)}>
      <summary>View as table</summary>
      {tableOpen&&<div className="table-wrap" tabIndex={0} role="region" aria-label="Chart values table">
        <table className="chart-data-table">
          <caption>Values plotted in the chart for the selected period{currency?", in "+currency:indexed?", indexed to 100 at the start":""}.</caption>
          <thead><tr><th scope="col">Date</th>{tableSeries.map((series)=><th scope="col" className="num" key={series.key}>{series.label}</th>)}</tr></thead>
          <tbody>{chartData.map((point)=><tr key={point.date}>
            <th scope="row">{formatDay(point.date,FULL_DATE)}</th>
            {tableSeries.map((series)=>{const value=series.read(point);return <td className="num" key={series.key}>{value==null?"—":formatValue(value)}</td>;})}
          </tr>)}</tbody>
        </table>
      </div>}
    </details>}
  </div>;
}
