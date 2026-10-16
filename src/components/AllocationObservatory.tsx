"use client";

import {useState,type PointerEvent} from "react";
import {useLandingCurrency} from "@/components/PublicLandingInteractivity";
import {calculateInstrument,illustrativeReviewDate} from "@/domain/public-allocation-observatory";

type ReviewInterval=30|90|365;
const intervals:ReviewInterval[]=[30,90,365];
const view={width:560,height:505,cx:280,cy:235};
function marker(percent:number,radius:number){
 const a=(percent/100*360-90)*Math.PI/180;
 return {x:view.cx+Math.cos(a)*radius,y:view.cy+Math.sin(a)*radius};
}
export function AllocationObservatory(){
 const {currency}=useLandingCurrency();
 const [contribution,setContribution]=useState(500);
 const [equity,setEquity]=useState(60);
 const [days,setDays]=useState<ReviewInterval>(90);
 const [dragging,setDragging]=useState(false);
 const calc=calculateInstrument(contribution,equity);
 const locale=currency==="GBP"?"en-GB":currency==="EUR"?"de-DE":"en-US";
 const format=new Intl.NumberFormat(locale,{style:"currency",currency,maximumFractionDigits:0});
 const money=(minor:number)=>format.format(minor/100);
 const signed=(minor:number)=>minor===0?money(0):(minor>0?"+":"−")+money(Math.abs(minor));
 const currentPoint=marker(calc.currentEquityPct,131);
 const targetPoint=marker(calc.targetEquityPct,184);
 const outerTip=marker(calc.targetEquityPct,221);
 const gapLabel=(gap:number)=>gap===0?"At target":gap>0?"Below target":"Above target";

 function drag(e:PointerEvent<SVGCircleElement>){
  const svg=e.currentTarget.ownerSVGElement;
  if(!svg)return;
  const rect=svg.getBoundingClientRect();
  if(!rect.width||!rect.height)return;
  const px=(e.clientX-rect.left)*view.width/rect.width;
  const py=(e.clientY-rect.top)*view.height/rect.height;
  const degrees=(Math.atan2(py-view.cy,px-view.cx)*180/Math.PI+90+360)%360;
  setEquity(Math.max(30,Math.min(80,Math.round(degrees/18)*5)));
 }
 return <section className="wm-obs" aria-labelledby="wm-obs-title">
  <div className="wm-obs-topline"><span id="wm-obs-title">THE ALLOCATION OBSERVATORY <span aria-hidden="true">↗</span></span>
   <span className="wm-obs-status"><i/> INTERACTIVE EXAMPLE / 01</span></div>
  <div className="wm-obs-visual">
   <svg viewBox="0 0 560 505" role="img" aria-label={`Illustrative portfolio allocation. Current equities ${calc.currentEquityPct} percent. Selected target equities ${calc.targetEquityPct} percent. Target equity difference ${signed(calc.equityGapMinor)}.`}>
    <defs>
     <radialGradient id="wm-obs-aura"><stop offset="0" stopColor="#bbefcf" stopOpacity=".13"/><stop offset=".55" stopColor="#87bdad" stopOpacity=".04"/><stop offset="1" stopColor="#86d8af" stopOpacity="0"/></radialGradient>
     <filter id="wm-obs-glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="7"/>
     </filter>
    </defs>
    <circle cx={view.cx} cy={view.cy} r="225" fill="url(#wm-obs-aura)"/>
    {[100,131,184,215].map(r=><circle key={r} cx={view.cx} cy={view.cy} r={r} fill="none" stroke="#e4efdc" strokeOpacity={r===215?.10:.07} strokeWidth=".7"/>)}
    <line x1={view.cx} x2={view.cx} y1="9" y2="458" stroke="#b0bdab" strokeOpacity=".09" strokeDasharray="2 7"/>
    <line x1="44" x2="516" y1={view.cy} y2={view.cy} stroke="#b0bdab" strokeOpacity=".09" strokeDasharray="2 7"/>
    {Array.from({length:36},(_,i)=>{
      const start=marker(i*100/36,214),end=marker(i*100/36,i%3===0?225:219);
      return <line key={i} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#bad5c2" strokeOpacity={i%3===0?.50:.18} strokeWidth={i%3===0?1.3:.7}/>;
    })}
    <g transform={`rotate(-90 ${view.cx} ${view.cy})`}>
     <circle cx={view.cx} cy={view.cy} r="184" pathLength="100" fill="none" stroke="#637374" strokeWidth="17" strokeOpacity=".28"/>
     <circle className={dragging?"wm-obs-target-segment dragging":"wm-obs-target-segment"} cx={view.cx} cy={view.cy} r="184" pathLength="100" fill="none" stroke="#c5f8c7" strokeWidth="17" strokeDasharray={`${calc.targetEquityPct} ${100-calc.targetEquityPct}`}/>
     <circle cx={view.cx} cy={view.cy} r="131" pathLength="100" fill="none" stroke="#677479" strokeWidth="23" strokeOpacity=".38"/>
     <circle cx={view.cx} cy={view.cy} r="131" pathLength="100" fill="none" stroke="#8ba3aa" strokeWidth="23" strokeDasharray={`${calc.currentEquityPct} ${100-calc.currentEquityPct}`}/>
    </g>
    <circle cx={targetPoint.x} cy={targetPoint.y} r="19" fill="#b7f5cc" opacity=".25" filter="url(#wm-obs-glow)"/>
    <line x1={targetPoint.x} y1={targetPoint.y} x2={outerTip.x} y2={outerTip.y} stroke="#d0ffd8" strokeWidth="1.2"/>
    <circle className="wm-obs-target-marker" cx={targetPoint.x} cy={targetPoint.y} r="9" fill="#d9ffe0" stroke="#1d372e" strokeWidth="4"/>
    <circle cx={currentPoint.x} cy={currentPoint.y} r="4.5" fill="#b6c7d0" stroke="#273e48" strokeWidth="2"/>
    <circle cx={view.cx} cy={view.cy} r="102" fill="#0a1315" fillOpacity=".86" stroke="#a6cbb5" strokeOpacity=".1"/>
    <text x="280" y="204" className="wm-obs-svg-eyebrow" textAnchor="middle">PORTFOLIO + CASH</text>
    <text x="280" y="246" className="wm-obs-svg-value" textAnchor="middle">{money(calc.totalMinor)}</text>
    <line x1="233" x2="327" y1="263" y2="263" stroke="#badbc8" strokeOpacity=".26"/>
    <text x="280" y="290" className="wm-obs-svg-sub" textAnchor="middle">EXAMPLE VALUE</text>
    <text x="280" y="22" className="wm-obs-svg-compass" textAnchor="middle">N</text>
    <text x="280" y="475" className="wm-obs-svg-compass" textAnchor="middle">S</text>
    <text x="41" y="240" className="wm-obs-svg-compass" textAnchor="middle">W</text>
    <text x="518" y="240" className="wm-obs-svg-compass" textAnchor="middle">E</text>
    <circle className="wm-obs-orbit-input" cx={view.cx} cy={view.cy} r="184" fill="none" stroke="transparent" strokeWidth="46" pointerEvents="stroke" style={{touchAction:"none",cursor:dragging?"grabbing":"grab"}}
     onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);setDragging(true);drag(e);}}
     onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))drag(e);}}
     onPointerUp={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);setDragging(false);}}
     onPointerCancel={()=>setDragging(false)}
     aria-hidden="true"/>
   </svg>
   <div className="wm-obs-axislabel wm-obs-axislabel-left"><b>64%</b><span>CURRENT</span></div>
   <div className="wm-obs-axislabel wm-obs-axislabel-right"><b>{equity}%</b><span>TARGET</span></div>
  </div>
  <div className="wm-obs-key"><span><i className="wm-obs-key-current"/> Existing equity share</span><span><i className="wm-obs-key-target"/> Target equity share</span></div>
  <div className="wm-obs-controls" aria-label="Change illustrative portfolio assumptions">
   <div className="wm-obs-control">
    <label htmlFor="wm-obs-contribution"><span>01 / ADD CASH</span><strong>{money(calc.contributionMinor)}</strong></label>
    <input id="wm-obs-contribution" type="range" min="0" max="2000" step="100" value={contribution} onChange={e=>setContribution(Number(e.target.value))}
     aria-valuetext={money(calc.contributionMinor)}/>
    <div className="wm-obs-range-ends"><span>{money(0)}</span><span>{money(200000)}</span></div>
   </div>
   <div className="wm-obs-control">
    <label htmlFor="wm-obs-equity"><span>02 / EQUITY TARGET</span><strong>{equity}%</strong></label>
    <input id="wm-obs-equity" type="range" min="30" max="80" step="5" value={equity} onChange={e=>setEquity(Number(e.target.value))}
     aria-valuetext={equity+" percent target equities"}/>
    <div className="wm-obs-range-ends"><span>30%</span><span>80%</span></div>
   </div>
  </div>
  <div className="wm-obs-equation" aria-live="polite" aria-atomic="true">
   <div><span>03 / EQUITY DIFFERENCE</span><strong>{signed(calc.equityGapMinor)}</strong><small>{gapLabel(calc.equityGapMinor)}</small></div>
   <div><span>04 / BOND DIFFERENCE</span><strong>{signed(calc.bondGapMinor)}</strong><small>{gapLabel(calc.bondGapMinor)}</small></div>
  </div>
  <div className="wm-obs-review">
   <span>ILLUSTRATIVE NEXT CHECK</span>
   <div className="wm-obs-review-options" role="group" aria-label="Example review interval">
    {intervals.map(d=><button key={d} type="button" aria-pressed={days===d} onClick={()=>setDays(d)}>{d===30?"30 days":d===90?"90 days":"365 days"}</button>)}
   </div>
   <strong>{illustrativeReviewDate(days)}</strong>
  </div>
  <p className="wm-obs-footnote">A fixed example: {money(calc.equityCurrentMinor)} equities + {money(calc.bondCurrentMinor)} bonds before added cash. Differences are target values minus recorded holdings; they total the contribution. No market prices, returns, trades or actual strategy schedules are implied. Drag the outer orbit or use the sliders.</p>
 </section>;
}
