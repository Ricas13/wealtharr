"use client";
import {useMemo,useState} from "react";
import {useLandingCurrency} from "@/components/PublicLandingInteractivity";

type Period="1M"|"3M"|"6M"|"1Y"|"ALL";
const periods:Period[]=["1M","3M","6M","1Y","ALL"];
// Synthetic examples, not historical prices, forecasts, or portfolio performance.
const examples=[18800,19110,19040,19480,19300,19750,20140,19990,20280,20510,20340,20890,21080,20860,21320,21410,21180,21820,22090,21980,22370,22560,22300,22910,23190,23040,23360,23610,23420,23940,24110,24000,24480,24290,24710,24850];
const BASE_DATE=Date.UTC(2026,8,9);

function curve(points:{x:number;y:number}[]){
  if(!points.length)return "";
  return points.reduce((d,p,i)=>{
    if(!i)return "M "+p.x+" "+p.y;
    const prev=points[i-1],mx=(prev.x+p.x)/2;
    return d+" C "+mx+" "+prev.y+", "+mx+" "+p.y+", "+p.x+" "+p.y;
  },"");
}
const POINTS_PER_PERIOD:Record<Period,number>={"1M":5,"3M":11,"6M":20,"1Y":30,"ALL":36};

export function MarketingHeroChart({revealProgress=1}:{revealProgress?:number}){
  const {currency}=useLandingCurrency();
  const fmt=new Intl.NumberFormat(currency==="GBP"?"en-GB":currency==="EUR"?"de-DE":"en-US",
    {style:"currency",currency,maximumFractionDigits:0,minimumFractionDigits:0});
  const [period,setPeriod]=useState<Period>("1Y");
  const [hover,setHover]=useState<number|null>(null);
  const [keyboardIndex,setKeyboardIndex]=useState<number|null>(null);
  const data=useMemo(()=>examples.slice(-POINTS_PER_PERIOD[period]),[period]);
  const active=Math.min(hover??keyboardIndex??data.length-1,data.length-1);
  const current=data[active],start=data[0];
  const visibleCurrent=Math.round(start+(current-start)*revealProgress);
  const change=visibleCurrent-start;
  const points=data.map((value,i)=>({x:16+i*368/(data.length-1),y:170-(value-18000)/7100*143}));
  const line=curve(points);
  const point=points[active];
  const date=new Date(BASE_DATE-(data.length-1-active)*10*86400000);
  function scrub(clientX:number,left:number,width:number){
    const x=Math.max(0,Math.min(1,(clientX-left)/width));
    setHover(Math.round(x*(data.length-1)));
  }
  return <div className="wm-interactive-chart">
    <div className="wm-chart-top">
      <div><span className="wm-chart-kicker">ILLUSTRATIVE STRATEGY VALUE</span>
        <strong className="wm-chart-value" aria-live="off">{fmt.format(visibleCurrent)}</strong>
        <span className="wm-chart-delta">{change>=0?"+":""}{fmt.format(change)} · {change>=0?"+":""}{((change/start)*100).toFixed(1)}% <span>since period start</span></span>
      </div>
      <div className="wm-chart-periods" role="group" aria-label="Example chart timeframe">
        {periods.map(p=><button key={p} type="button" aria-pressed={period===p} className={period===p?"active":""} onClick={()=>{setPeriod(p);setHover(null);setKeyboardIndex(null);}}>{p==="ALL"?"All":p}</button>)}
      </div>
    </div>
    <div className="wm-chart-plot">
      <svg viewBox="0 0 400 200" preserveAspectRatio="none" role="img" aria-label="Interactive fictional portfolio value example. Use pointer or arrow keys to inspect values.">
        <defs>
          <linearGradient id="wmHeroFill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#a3e7c0" stopOpacity=".19"/><stop offset="1" stopColor="#a3e7c0" stopOpacity="0"/></linearGradient>
          <linearGradient id="wmHeroStroke" x1="0" x2="1"><stop stopColor="#648d8e"/><stop offset=".6" stopColor="#a5e4c2"/><stop offset="1" stopColor="#dcffe2"/></linearGradient>
          <clipPath id="wmHeroReveal"><rect x="0" y="0" width={400*revealProgress} height="200"/></clipPath>
        </defs>
        {[35,78,121,170].map(y=><line key={y} x1="16" x2="384" y1={y} y2={y} stroke="#c7e7de" strokeOpacity=".10" strokeDasharray="2 5"/>)}
        <g clipPath="url(#wmHeroReveal)">
        <path d={line+" L384 185 L16 185 Z"} fill="url(#wmHeroFill)"/>
        <path d={line} fill="none" stroke="#86e6b8" strokeOpacity=".12" strokeWidth="7" strokeLinecap="round"/>
        <path d={line} fill="none" stroke="url(#wmHeroStroke)" strokeWidth="1.9" strokeLinecap="round"/>
        </g>
        <g opacity={revealProgress>=0.99?1:0}>
        <line x1={point.x} x2={point.x} y1="14" y2="185" stroke="#d6e8de" strokeDasharray="3 4" strokeOpacity=".48"/>
        <circle cx={point.x} cy={point.y} r="5" fill="#d0fce0" fillOpacity=".15"/>
        <circle cx={point.x} cy={point.y} r="2.8" fill="#d6ffe4" stroke="#143328" strokeWidth="1"/>
        </g>
        <rect x="0" y="0" width="400" height="200" fill="transparent"
          onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect();scrub(e.clientX,rect.left,rect.width);}}
          onPointerLeave={()=>setHover(null)}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);const rect=e.currentTarget.getBoundingClientRect();scrub(e.clientX,rect.left,rect.width);}}
          onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}}
        />
      </svg>
      <div className="wm-chart-hover-label" style={{left:(point.x/400*100)+"%"}}>{date.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</div>
    </div>
    <input className="wm-chart-keyboard" type="range" min={0} max={data.length-1} value={active} aria-label="Browse illustrative portfolio values by date" aria-valuetext={date.toLocaleDateString("en-GB",{dateStyle:"medium"})+": "+fmt.format(current)} onChange={e=>{setHover(null);setKeyboardIndex(Number(e.target.value));}}/>
    <div className="wm-chart-caption"><span>Earlier</span><span>Fictional example · not investment performance</span><span>Latest</span></div>
  </div>;
}
