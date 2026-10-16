"use client";
import {useEffect,useRef,useState} from "react";
import {useLandingCurrency} from "@/components/PublicLandingInteractivity";
import {MarketingHeroChart} from "@/components/MarketingHeroChart";

const START=20140;
const END=24850;
const DURATION=3400;

export function HeroStrategyPreview(){
 const {currency}=useLandingCurrency();
 const [progress,setProgress]=useState(0);
 const holder=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const el=holder.current;
  if(!el)return;
  const media=window.matchMedia("(prefers-reduced-motion: reduce)");
  if(media.matches){
   const frame=requestAnimationFrame(()=>setProgress(1));
   return ()=>cancelAnimationFrame(frame);
  }
  let frame=0,startTime=0,started=false;
  const advance=(now:number)=>{
   if(!startTime)startTime=now;
   const t=Math.min(1,(now-startTime)/DURATION);
   setProgress(1-Math.pow(1-t,3));
   if(t<1)frame=requestAnimationFrame(advance);
  };
  const observer=new IntersectionObserver(entries=>{
   if(entries[0]?.isIntersecting&&!started){
    started=true;frame=requestAnimationFrame(advance);observer.disconnect();
   }
  },{threshold:0.18});
  observer.observe(el);
  return ()=>{observer.disconnect();cancelAnimationFrame(frame);};
 },[]);
 // These numbers and the graphic illustrate the user experience, not returns or forecasts.
 const value=Math.round(START+(END-START)*progress);
 const shown=new Intl.NumberFormat(currency==="GBP"?"en-GB":currency==="EUR"?"de-DE":"en-US",{
  style:"currency",currency,maximumFractionDigits:0,minimumFractionDigits:0
 }).format(value);
 const contribution=new Intl.NumberFormat(currency==="GBP"?"en-GB":currency==="EUR"?"de-DE":"en-US",{
  style:"currency",currency,maximumFractionDigits:0,minimumFractionDigits:0
 }).format(500);
 return <div className="wm-preview" ref={holder} aria-label="Illustrative strategy-tracking dashboard — example values, not actual returns">
  <div className="wm-preview-header"><strong>◈ &nbsp; Overview <span>/ Strategy check-in</span></strong><small>ILLUSTRATIVE DATA</small></div>
  <div className="wm-preview-body">
   <div className="wm-preview-title"><div><small>A RULE-BASED INVESTMENT APPROACH</small>
    <h2>Follow your strategy. Know your next step.</h2>
   </div><span>Example only</span></div>
   <div className="wm-preview-kpis">
    <div><small>Illustrative portfolio</small><strong className="wm-counter" aria-label="Illustrative portfolio value">{shown}</strong></div>
    <div><small>Strategy sleeves</small><strong>4 allocations</strong></div>
    <div><small>Next contribution</small><strong>{contribution}</strong></div>
   </div>
   <div className="wm-preview-cols"><div className="wm-chart">
    <MarketingHeroChart revealProgress={progress}/>
   </div><div className="wm-allocation">
    <div className="wm-panel-title">Strategy targets <span>Current / Target</span></div>
    {([["Equities",29,30],["Bonds",52,55],["Gold",9,8],["Commodities",10,7]] as const).map(([label,actual,target])=>
     <div className="wm-allocation-row" key={label}><div><span>{label}</span><span>{actual}% / {target}%</span></div>
      <div className="wm-track"><i style={{width:actual+"%"}}/><b style={{left:target+"%"}}/></div>
     </div>)}
   </div></div>
   <div className="wm-sample-notice"><span aria-hidden="true">↗</span>
    <div><strong>One place to follow the rules</strong>
     <p>Track contributions, allocations and reviews. Wealtharr calculates; you decide when to trade.</p>
    </div>
   </div>
  </div>
 </div>;
}
