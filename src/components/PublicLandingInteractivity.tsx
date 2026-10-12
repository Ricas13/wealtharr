"use client";

import {useEffect,useRef,useState} from "react";
import Link from "next/link";

export type PublicStrategyCard={
  key:string;name:string;description:string;category:string;
  allocations:Array<{label:string;percent:string}>;
};
export type PublicPlanCard={
  slug:string;name:string;description:string;currency:string;
  monthlyMinor:number|null;annualMinor:number|null;maxActive:number|null;
  features:string[];channels:string[];highlights:string[];
};
function priceLabel(amount:number,currency:string){
  return new Intl.NumberFormat("en-GB",{style:"currency",currency,minimumFractionDigits:amount===0?0:2}).format(amount/100);
}
export function PublicStrategyRail({cards}:{cards:PublicStrategyCard[]}){
  const rail=useRef<HTMLDivElement>(null);
  const held=useRef(false);
  useEffect(()=>{
    const el=rail.current;
    if(!el||cards.length<2||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    let frame=0,last=0;
    const tick=(now:number)=>{
      if(!last)last=now;
      const delta=Math.min(40,now-last);last=now;
      if(!held.current&&el.scrollWidth>el.clientWidth){
        el.scrollLeft+=(delta/1000)*22;
        const halfway=el.scrollWidth/2;
        if(el.scrollLeft>=halfway)el.scrollLeft-=halfway;
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  },[cards.length]);
  if(cards.length===0)return <p className="wm-empty">No fully released strategies are currently available for the example UK ISA market. Sign in to see what is eligible for your own account.</p>;
  const card=(c:PublicStrategyCard,i:number,duplicate=false)=><article key={c.key+"-"+i} className="wm-strategy-card" aria-hidden={duplicate||undefined}>
    <span className="wm-kicker">{c.category}</span>
    <h3>{c.name}</h3>
    <p>{c.description}</p>
    {c.allocations.length>0&&<div className="wm-sleeves" aria-label={duplicate?undefined:"Target allocation illustration"}>
      {c.allocations.map((a,n)=><span key={a.label} title={a.label+": "+a.percent+"%"} style={{width:a.percent+"%",background:["#9bcdb9","#8fa9d2","#e2c19b","#aaa1c4","#bdd0b8"][n%5]}} />)}
    </div>}
    <div className="wm-strategy-end"><span>{c.allocations.length?c.allocations.length+" allocations":"Rule-based method"}</span>{duplicate?<span>Learn more ↗</span>:<Link href="/strategies">Learn more ↗</Link>}</div>
  </article>;
  return <div className="wm-rail-block">
    <div className="wm-rail-controls">
      <button aria-label="Scroll strategies left" onClick={()=>{held.current=true;rail.current?.scrollBy({left:-310,behavior:"smooth"});}} type="button">←</button>
      <button aria-label="Scroll strategies right" onClick={()=>{held.current=true;rail.current?.scrollBy({left:310,behavior:"smooth"});}} type="button">→</button>
    </div>
    <div className="wm-rail" tabIndex={0} ref={rail}
      onMouseEnter={()=>held.current=true} onMouseLeave={()=>held.current=false}
      onFocus={()=>held.current=true} onBlur={()=>held.current=false}
      onPointerDown={()=>held.current=true}
      role="region" aria-label="Released UK ISA strategy examples, horizontally scrollable">
      <div className="wm-rail-track">{cards.map((c,i)=>card(c,i))}
        {cards.length>1&&cards.map((c,i)=>card(c,i,true))}
      </div>
    </div>
  </div>;
}
export function PublicPricingCards({plans}:{plans:PublicPlanCard[]}){
  const [annual,setAnnual]=useState(false);
  if(!plans.length)return <div className="wm-empty">There are no subscription plans currently published. Plan options will appear here once configured by the administrator. <Link href="/login">Sign in</Link></div>;
  return <>
    <div className="wm-billing" role="group" aria-label="Show monthly or annual plan pricing">
      <button type="button" className={!annual?"selected":""} aria-pressed={!annual} onClick={()=>setAnnual(false)}>Monthly</button>
      <button type="button" className={annual?"selected":""} aria-pressed={annual} onClick={()=>setAnnual(true)}>Yearly</button>
    </div>
    <div className="wm-plan-grid">{plans.map((p,i)=>{
      const effectiveAnnual=annual&&p.annualMinor!==null;
      const amount=effectiveAnnual?p.annualMinor:p.monthlyMinor;
      const desc=p.description.trim();
      const featureLabels:Record<string,string>={history:"Transaction history",reconciliation:"Broker reconciliation",resume:"Resume existing investments",community:"Anonymous community insights",analytics:"Advanced analytics",comparisons:"Benchmark comparisons",what_if:"What-if analysis",advanced_imports:"Advanced imports",multi_account:"Multiple accounts"};
      const perks=[p.maxActive===null?"Unlimited active strategies":p.maxActive+" active strateg"+(p.maxActive===1?"y":"ies"),
        "In-app strategy reviews",...p.features.map(f=>featureLabels[f]).filter((f):f is string=>Boolean(f)),
        ...p.channels.map(c=>c==="EMAIL"?"Email notifications":c==="DISCORD"?"Discord notifications":c==="TELEGRAM"?"Telegram notifications":c)].slice(0,7);
      return <article className={"wm-plan"+(i===1?" featured":"")} key={p.slug}>
        <div className="wm-plan-name">{p.name}</div>
        <p>{desc||"Follow published strategy rules in one convenient workspace."}</p>
        {p.highlights.length>0&&<div className="wm-marketing-notes">{p.highlights.map((line,n)=><span key={n}>{line}</span>)}</div>}
        <div className="wm-plan-price">{amount===null?"Unavailable":priceLabel(amount,p.currency)}{amount!==null&&<small> / {effectiveAnnual?"year":"month"}</small>}</div>
        <span className="wm-plan-billed">{annual&&!effectiveAnnual?"Annual billing not offered":effectiveAnnual?"Charged annually":"Subscription billed monthly"}</span>
        <ul>{perks.map((perk,n)=><li key={n}>{perk}</li>)}</ul>
        <Link className={"wm-button"+(i===1?" main":" outline")} href="/register">Explore {p.name} ↗</Link>
      </article>;
    })}</div>
  </>;
}
