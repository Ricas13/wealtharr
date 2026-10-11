"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { rebaseIndexedWindow, periodCutoffIso } from "@/domain/chart-window";

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


function compact(value:number){
  return new Intl.NumberFormat("en-GB",{notation:"compact",maximumFractionDigits:1}).format(value);
}

export function PerformanceChart({
  data,markers=[],comparisons=[],actualLabel="Your portfolio",indexed=false,fullControls=false
}:{
  data:Point[];
  markers?:Marker[];
  comparisons?:ComparisonSeries[];
  actualLabel?:string;
  indexed?:boolean;
  fullControls?:boolean;
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

  if(!data.length) return <div className="empty">Performance appears here once the strategy has enough valued history.</div>;

  return <div className="performance-chart">
    <div className="chart-toolbar">
      <div className="timeframes" aria-label="Chart timeframe">{(fullControls?fullFrames:frames).map((f)=><button type="button" key={f} className={"timeframe "+(frame===f?"active":"")} aria-pressed={frame===f} onClick={()=>setFrame(f)}>{f}</button>)}</div>
      {frame==="CUSTOM"&&<div className="chart-date-range"><span>From <input aria-label="Chart custom start date" type="date" max={customEnd||latestDate} value={customStart} onChange={event=>setCustomStart(event.target.value)}/></span><span>To <input aria-label="Chart custom end date" type="date" min={customStart||undefined} max={latestDate} value={customEnd} onChange={event=>setCustomEnd(event.target.value)}/></span></div>}
      <div className="series-toggles" aria-label="Chart comparisons">
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
    {filteredMarkers.length>0&&<div className="chart-markers" aria-label="Chart event markers"><span className="chart-marker-key contribution">+ Contributions</span><span className="chart-marker-key review">R Reviews</span></div>}
    <div className="chart-wrap" role="img" aria-label="Interactive portfolio performance chart"><ResponsiveContainer width="100%" height="100%">
      <AreaChart data={chartData} margin={{top:22,right:8,left:0,bottom:0}} accessibilityLayer>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-actual)" stopOpacity={.28}/><stop offset="100%" stopColor="var(--chart-actual)" stopOpacity={0}/></linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)"/>
        <XAxis dataKey="date" tick={{fill:"var(--chart-axis)",fontSize:10}} axisLine={false} tickLine={false} minTickGap={30}/>
        <YAxis tick={{fill:"var(--chart-axis)",fontSize:10}} tickFormatter={(v)=>compact(Number(v))} axisLine={false} tickLine={false} width={48}/>
        {filteredMarkers.map((marker,index)=><ReferenceLine key={marker.type+marker.date+index} x={marker.date} stroke={marker.type==="CONTRIBUTION"?"var(--chart-model)":"var(--chart-comparison-1)"} strokeOpacity={.42} strokeDasharray="3 5" label={{value:marker.type==="CONTRIBUTION"?"+":"R",position:"insideTop",fill:marker.type==="CONTRIBUTION"?"var(--chart-model)":"var(--chart-comparison-1)",fontSize:10}} ifOverflow="extendDomain"/>)}
        <Tooltip
          contentStyle={{background:"var(--chart-tooltip-bg)",border:"1px solid var(--line)",borderRadius:14,boxShadow:"var(--shadow)",color:"var(--text)"}}
          labelStyle={{color:"var(--muted)",fontSize:11}}
          itemStyle={{fontSize:12}}
          formatter={(value,name)=>[new Intl.NumberFormat("en-GB",{maximumFractionDigits:2}).format(Number(value)),String(name)]}
        />
        {showActual&&<Area type="monotone" dataKey="actual" name={actualLabel} stroke="var(--chart-actual)" fill={"url(#"+gradientId+")"} strokeWidth={3} connectNulls isAnimationActive={!reduceMotion} animationDuration={650}/>}
        {showModel&&<Area type="monotone" dataKey="model" name="Strategy model" stroke="var(--chart-model)" fillOpacity={0} strokeWidth={2.25} connectNulls isAnimationActive={!reduceMotion} animationDuration={650}/>}
        {availableComparisons.map((series,index)=>visibleComparisons[series.key]&&<Area
          key={series.key}
          type="monotone"
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
  </div>;
}
