"use client";

import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from "react";
import type {LandingCurrency} from "@/domain/visitor-currency";
import Link from "next/link";
import {formatMinorCurrency} from "@/domain/currency-money";

export type PublicStrategyCard={
  key:string;name:string;description:string;category:string;
  allocations:Array<{label:string;percent:string}>;
};
export type PublicPlanCard={
  slug:string;name:string;description:string;currency:string;
  monthlyMinor:number|null;annualMinor:number|null;maxActive:number|null;
  features:string[];channels:string[];highlights:string[];
  prices:Partial<Record<LandingCurrency,{monthly:number|null;annual:number|null}>>;
};
type CurrencyState={currency:LandingCurrency;choose:(next:LandingCurrency)=>void};
const CurrencyContext=createContext<CurrencyState|null>(null);
const STORAGE_KEY="wealtharr.marketing.currency";
export function LandingCurrencyProvider({initialCurrency,children}:{initialCurrency:LandingCurrency;children:ReactNode}){
 const [currency,setCurrency]=useState<LandingCurrency>(initialCurrency);
 useEffect(()=>{
  let frame=0;
  try{
   const saved=window.localStorage.getItem(STORAGE_KEY);
   if(saved==="GBP"||saved==="EUR"||saved==="USD")
    frame=requestAnimationFrame(()=>setCurrency(saved));
  }catch{/* Browsing without persistent storage is supported. */}
  return ()=>cancelAnimationFrame(frame);
 },[]);
 const choose=(next:LandingCurrency)=>{
  setCurrency(next);
  try{window.localStorage.setItem(STORAGE_KEY,next);}catch{/* State still changes. */}
 };
 return <CurrencyContext.Provider value={{currency,choose}}>{children}</CurrencyContext.Provider>;
}
export function useLandingCurrency():CurrencyState{
 const value=useContext(CurrencyContext);
 if(!value)throw new Error("LandingCurrencyProvider required");
 return value;
}
function priceLabel(amount:number,currency:string){
  // The Free card deliberately reads £0 rather than £0.00.
  if(amount===0)return new Intl.NumberFormat("en-GB",{style:"currency",currency,minimumFractionDigits:0,maximumFractionDigits:0}).format(0);
  return formatMinorCurrency(amount,currency);
}
export function PublicStrategyRail({cards}:{cards:PublicStrategyCard[]}){
 const rail=useRef<HTMLDivElement>(null);
 const held=useRef(false);
 const pausedUntil=useRef(0);
 useEffect(()=>{
  const el=rail.current;
  if(!el||cards.length<2)return;
  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  if(reduced.matches)return;
  let frame=0,last=0;
  const tick=(now:number)=>{
   if(!last)last=now;
   const delta=Math.min(50,now-last);last=now;
   if(!held.current&&now>=pausedUntil.current&&!document.hidden&&el.scrollWidth>el.clientWidth){
    el.scrollLeft+=(delta/1000)*30;
    const track=el.firstElementChild as HTMLElement|null;
    const first=track?.children[0] as HTMLElement|undefined;
    const duplicate=track?.children[cards.length] as HTMLElement|undefined;
    const loop=first&&duplicate?duplicate.offsetLeft-first.offsetLeft:0;
    if(loop>0&&el.scrollLeft>=loop)el.scrollLeft-=loop;
   }
   frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);
  return ()=>cancelAnimationFrame(frame);
 },[cards.length]);
 const scroll=(direction:-1|1)=>{
  const el=rail.current;
  if(!el)return;
  pausedUntil.current=performance.now()+5500;
  const track=el.firstElementChild as HTMLElement|null;
  const first=track?.children[0] as HTMLElement|undefined;
  const duplicate=track?.children[cards.length] as HTMLElement|undefined;
  const loop=first&&duplicate?duplicate.offsetLeft-first.offsetLeft:0;
  if(direction<0&&el.scrollLeft<10&&loop>0)el.scrollLeft=loop;
  el.scrollBy({left:direction*310,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
 };
 if(cards.length===0)return <p className="wm-empty">Strategy examples will appear here shortly.</p>;
 const render=(c:PublicStrategyCard,i:number,duplicate=false)=><article key={c.key+"-"+i+(duplicate?"-copy":"")} className="wm-strategy-card" aria-hidden={duplicate||undefined}>
  <span className="wm-kicker">{c.category}</span>
  <h3>{c.name}</h3>
  <p>{c.description}</p>
  {c.allocations.length>0&&<div className="wm-sleeves" aria-label={duplicate?undefined:"Illustrative target allocations"}>
   {c.allocations.map((a,n)=><span key={a.label} title={a.label+": "+a.percent+"%"} style={{width:a.percent+"%",background:["#9bcdb9","#8fa9d2","#e2c19b","#aaa1c4","#bdd0b8"][n%5]}}/>)}
  </div>}
  <div className="wm-strategy-end"><span>{c.allocations.length?c.allocations.length+" sleeves":"Rule-based method"}</span>
   {duplicate?<span>Learn more ↗</span>:<Link href="/strategies">Learn more ↗</Link>}
  </div>
 </article>;
 return <div className="wm-rail-block">
  <div className="wm-rail-controls">
   <button aria-label="Scroll strategies left" onClick={()=>scroll(-1)} type="button">←</button>
   <button aria-label="Scroll strategies right" onClick={()=>scroll(1)} type="button">→</button>
  </div>
  <div className="wm-rail" tabIndex={0} ref={rail}
   onMouseEnter={()=>held.current=true} onMouseLeave={()=>held.current=false}
   onFocus={()=>held.current=true} onBlur={()=>held.current=false}
   onPointerDown={()=>pausedUntil.current=performance.now()+6500}
   onTouchStart={()=>pausedUntil.current=performance.now()+6500}
   role="region" aria-label="Investment strategy examples, continuously scrolling; hover or focus to pause">
   <div className="wm-rail-track">{cards.map((c,i)=>render(c,i))}
    {cards.length>1&&cards.map((c,i)=>render(c,i,true))}
   </div>
  </div>
 </div>;
}
export function PublicPricingCards({plans}:{plans:PublicPlanCard[]}){
  const [annual,setAnnual]=useState(false);
  const {currency,choose}=useLandingCurrency();
  if(!plans.length)return <div className="wm-empty">There are no subscription plans currently published. Plan options will appear here once configured by the administrator. <Link href="/login">Sign in</Link></div>;
  return <>
    <div className="wm-billing" role="group" aria-label="Show monthly or annual plan pricing">
      <button type="button" className={!annual?"selected":""} aria-pressed={!annual} onClick={()=>setAnnual(false)}>Monthly</button>
      <button type="button" className={annual?"selected":""} aria-pressed={annual} onClick={()=>setAnnual(true)}>Yearly</button>
    </div>
    <div className="wm-currency-choice" role="group" aria-label="Preferred pricing currency">
      {(["GBP","EUR","USD"] as const).map(unit=><button type="button" key={unit} aria-pressed={currency===unit} className={currency===unit?"selected":""} onClick={()=>choose(unit)}>{unit==="GBP"?"£ GBP":unit==="EUR"?"€ EUR":"$ USD"}</button>)}
    </div>
    <div className="wm-plan-grid">{plans.map((p,i)=>{
      // Never invent exchange rates. Show only amounts configured by the owner for
      // the selected currency; otherwise label the configured billing currency clearly.
      const desired=p.prices[currency];
      const hasPrice=Boolean(desired&&(desired.monthly!==null||desired.annual!==null));
      const displayedCurrency=p.slug==="free"?currency:hasPrice?currency:p.currency;
      const money=p.slug==="free"?{monthly:0,annual:0}:hasPrice?desired!:{monthly:p.monthlyMinor,annual:p.annualMinor};
      const effectiveAnnual=annual&&money.annual!==null;
      const amount=effectiveAnnual?money.annual:money.monthly;
      const desc=p.description.trim();
      const featureLabels:Record<string,string>={history:"Transaction history",reconciliation:"Broker reconciliation",resume:"Resume existing investments",community:"Anonymous community insights",analytics:"Advanced analytics",comparisons:"Benchmark comparisons",what_if:"What-if analysis",advanced_imports:"Advanced imports",multi_account:"Multiple accounts"};
      const perks=[p.maxActive===null?"Unlimited active strategies":p.maxActive+" active strateg"+(p.maxActive===1?"y":"ies"),
        "In-app strategy reviews",...p.features.map(f=>featureLabels[f]).filter((f):f is string=>Boolean(f)),
        ...p.channels.map(c=>c==="EMAIL"?"Email notifications":c==="DISCORD"?"Discord notifications":c==="TELEGRAM"?"Telegram notifications":c)].slice(0,7);
      return <article className={"wm-plan"+(i===1?" featured":"")} key={p.slug}>
        <div className="wm-plan-name">{p.name}</div>
        <p>{desc||"Follow published strategy rules in one convenient workspace."}</p>
        {p.highlights.length>0&&<div className="wm-marketing-notes">{p.highlights.map((line,n)=><span key={n}>{line}</span>)}</div>}
        <div className="wm-plan-price">{amount===null?"Unavailable":priceLabel(amount,displayedCurrency)}{amount!==null&&<small> / {effectiveAnnual?"year":"month"}</small>}</div>
        <span className="wm-plan-billed">{annual&&!effectiveAnnual?"Annual billing not offered":effectiveAnnual?"Charged annually":"Subscription billed monthly"}</span>
        {p.slug!=="free"&&!hasPrice&&displayedCurrency!==currency&&<span className="wm-plan-currency-note">Prices in {displayedCurrency}: {currency} billing has not been configured. No estimated conversion.</span>}
        <ul>{perks.map((perk,n)=><li key={n}>{perk}</li>)}</ul>
        <Link className={"wm-button"+(i===1?" main":" outline")} href="/register">Explore {p.name} ↗</Link>
      </article>;
    })}</div>
  </>;
}
