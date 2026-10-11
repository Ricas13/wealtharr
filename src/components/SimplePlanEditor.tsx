"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Marketing = { title:string; subtitle:string; badge:string; cta:string; benefits:string[]; featured:boolean };
type Entitlements = {features:string[];notificationChannels:string[]};
type Config = {
 slug:string;displayName:string;description:string;monthlyPriceMinor:number;annualPriceMinor:number;
 annualDiscountBps:number;currency:string;supportedBillingCurrencies:string[];
 maxActiveStrategies:number|null;availableStrategyKeys:string[];
 stripeMonthlyPriceId:string|null;stripeAnnualPriceId:string|null;entitlements:Entitlements;
 trialDays:number;visible:boolean;archived:boolean;sortOrder:number;
 marketing:Marketing;paymentMethods:string[];
};
const featureOptions=[
 ["history","Transaction history"],["reconciliation","Broker reconciliation"],["resume","Resume existing investments"],
 ["community","Anonymous community statistics"],["analytics","Advanced analytics"],
 ["comparisons","Benchmark comparisons"],["what_if","What-if analysis"],
 ["advanced_imports","Advanced imports"],["multi_account","Multiple accounts per strategy"]
] as const;
const channelOptions=[["EMAIL","Email"],["DISCORD","Discord"],["TELEGRAM","Telegram"]] as const;
const blank:Config={
 slug:"",displayName:"",description:"",monthlyPriceMinor:0,annualPriceMinor:0,annualDiscountBps:0,
 currency:"GBP",supportedBillingCurrencies:["GBP"],maxActiveStrategies:1,availableStrategyKeys:[],
 stripeMonthlyPriceId:null,stripeAnnualPriceId:null,
 entitlements:{features:[],notificationChannels:[]},trialDays:0,visible:false,archived:false,sortOrder:50,
 marketing:{title:"",subtitle:"",badge:"",cta:"Choose plan",benefits:[],featured:false},
 paymentMethods:["STRIPE"]
};
function normalise(p:Config):Config {
 return {...p,entitlements:{
   features:Array.isArray(p.entitlements?.features)?p.entitlements.features:[],
   notificationChannels:Array.isArray(p.entitlements?.notificationChannels)?p.entitlements.notificationChannels:[]
 },marketing:{
   title:String(p.marketing?.title??p.displayName),
   subtitle:String(p.marketing?.subtitle??p.description),
   badge:String(p.marketing?.badge??""),
   cta:String(p.marketing?.cta??"Choose "+p.displayName),
   benefits:Array.isArray(p.marketing?.benefits)?p.marketing.benefits:[],
   featured:p.marketing?.featured===true
 },paymentMethods:Array.isArray(p.paymentMethods)?p.paymentMethods:["STRIPE"]};
}
export function SimplePlanEditor({initialPlans,strategies}:{initialPlans:Config[];strategies:Array<{key:string;name:string;enabled:boolean}>}) {
 const router=useRouter();
 const [selection,setSelection]=useState(initialPlans[0]?.slug??"new");
 const [form,setForm]=useState<Config>(()=>normalise(initialPlans[0]??blank));
 const [tab,setTab]=useState<"card"|"billing"|"features">("card");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState(false);
 const count=initialPlans.filter(p=>p.slug!=="free"&&p.visible&&!p.archived).length;
 const published=initialPlans.filter(p=>p.visible&&!p.archived).length;
 function choose(slug:string) {
  setSelection(slug);setMessage("");setError(false);
  setForm(normalise(initialPlans.find(p=>p.slug===slug)??blank));
 }
 function change<K extends keyof Config>(key:K,value:Config[K]) {setForm(p=>({...p,[key]:value}));}
 function updateMarketing<K extends keyof Marketing>(key:K,value:Marketing[K]) {
  setForm(p=>({...p,marketing:{...p.marketing,[key]:value}}));
 }
 function toggle(key:"features"|"notificationChannels",value:string) {
  setForm(p=>{const set=new Set(p.entitlements[key]);if(set.has(value))set.delete(value);else set.add(value);
    return {...p,entitlements:{...p.entitlements,[key]:[...set]}};});
 }
 function toggleStrategy(key:string) {
  setForm(p=>{const set=new Set(p.availableStrategyKeys);if(set.has(key))set.delete(key);else set.add(key);
   return {...p,availableStrategyKeys:[...set]};});
 }
 function toggleProvider(value:string) {
  setForm(p=>{const set=new Set(p.paymentMethods);if(set.has(value))set.delete(value);else set.add(value);
   return {...p,paymentMethods:[...set]};});
 }
 async function save(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();setBusy(true);setMessage("");setError(false);
  try {
   const response=await fetch("/api/admin/plans",{
    method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({...form,marketing:{
      ...form.marketing,
      title:form.marketing.title.trim()||form.displayName,
      subtitle:form.marketing.subtitle.trim()||form.description,
      benefits:form.marketing.benefits.map(x=>x.trim()).filter(Boolean)
    }})
   });
   const data=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(data.error||"Could not save the plan.");
   setMessage(data.enforcementFailures?
     "Saved, but "+data.enforcementFailures+" customer entitlement checks failed. Inspect operations.":
     "Saved successfully. Published cards now use these settings.");
   router.refresh();
  } catch (e) {setError(true);setMessage(e instanceof Error?e.message:"Could not save the plan.");}
  finally {setBusy(false);}
 }
 const newBlocked=false;
 const canPublish=!form.archived&&(form.visible||published<5);
 const perks=form.marketing.benefits.length?form.marketing.benefits:[form.maxActiveStrategies===null?
    "Unlimited active strategies":String(form.maxActiveStrategies)+" active strategies"];
 return <form className="glass form-card" onSubmit={save}>
  <h2>Plans &amp; pricing studio</h2>
  <p className="help">Edit a plan, its actual entitlements, and the separate marketing copy displayed on the public homepage. Hidden or archived plans do not appear publicly.</p>
  <div className="why-row"><strong>{published}/5 published</strong><span>Hidden plans do not count towards the public limit</span></div>
  <div className="field"><label htmlFor="plan-studio-select">Choose a plan</label>
   <select id="plan-studio-select" value={selection} onChange={e=>choose(e.target.value)}>
    {initialPlans.map(p=><option value={p.slug} key={p.slug}>{p.displayName} ({p.archived?"archived":p.visible?"published":"hidden"})</option>)}
    <option value="new">+ Create a draft plan</option>
   </select>
  </div>
  <div className="form-grid">
   <div className="field"><label htmlFor="plan-studio-slug">Plan ID</label><input id="plan-studio-slug" required readOnly={selection!=="new"} pattern="[a-z][a-z0-9-]*" maxLength={60} value={form.slug} onChange={e=>change("slug",e.target.value.toLowerCase())}/></div>
   <div className="field"><label htmlFor="plan-studio-name">Internal plan name</label><input id="plan-studio-name" required value={form.displayName} maxLength={70} onChange={e=>change("displayName",e.target.value)}/></div>
  </div>
  <div className="why-row" style={{marginTop:16,gap:8,flexWrap:"wrap"}}>
   {(["card","billing","features"] as const).map(x=><button type="button" className={"button"+(tab===x?" primary":"")} key={x} onClick={()=>setTab(x)}>
    {x==="card"?"Homepage card":x==="billing"?"Billing & providers":"Feature permissions"}
   </button>)}
  </div>
  {tab==="card"&&<div className="stack" style={{marginTop:18}}>
   <div className="form-grid">
    <div className="field"><label htmlFor="plan-marketing-title">Card title</label><input id="plan-marketing-title" maxLength={70} value={form.marketing.title} onChange={e=>updateMarketing("title",e.target.value)}/></div>
    <div className="field"><label htmlFor="plan-marketing-badge">Badge (optional)</label><input id="plan-marketing-badge" maxLength={40} placeholder="MOST POPULAR" value={form.marketing.badge} onChange={e=>updateMarketing("badge",e.target.value)}/></div>
    <div className="field full"><label htmlFor="plan-marketing-summary">Card description</label><textarea id="plan-marketing-summary" rows={3} maxLength={280} value={form.marketing.subtitle} onChange={e=>updateMarketing("subtitle",e.target.value)}/></div>
    <div className="field full"><label htmlFor="plan-marketing-benefits">Displayed benefits (one per line, maximum 8)</label><textarea id="plan-marketing-benefits" rows={5}
     value={form.marketing.benefits.join("\n")} onChange={e=>updateMarketing("benefits",e.target.value.split("\n").slice(0,8))}/></div>
    <div className="field full"><label htmlFor="plan-marketing-cta">Button text</label><input id="plan-marketing-cta" maxLength={70} value={form.marketing.cta} onChange={e=>updateMarketing("cta",e.target.value)}/></div>
   </div>
   <label className="toggle-row"><input type="checkbox" checked={form.marketing.featured} onChange={e=>updateMarketing("featured",e.target.checked)}/>Highlight as featured</label>
   <label className="toggle-row"><input type="checkbox" checked={form.visible} disabled={!canPublish} onChange={e=>change("visible",e.target.checked)}/>Publish this plan publicly</label>
   <label className="toggle-row"><input type="checkbox" checked={form.archived} disabled={form.slug==="free"} onChange={e=>{change("archived",e.target.checked);if(e.target.checked)change("visible",false);}}/>Archive plan (preserves subscriber history; stops new sign-ups)</label>
   <div className="field"><label htmlFor="plan-sort">Card display order</label><input id="plan-sort" type="number" value={form.sortOrder} onChange={e=>change("sortOrder",Number(e.target.value))}/></div>
   <div className="card" aria-label="Marketing card preview" style={{padding:22}}>
    {form.marketing.badge&&<span className="pill">{form.marketing.badge}</span>}
    <h3 style={{marginTop:12}}>{form.marketing.title||form.displayName||"New plan"}</h3>
    <p>{form.marketing.subtitle||"Plan description"}</p>
    <h3>{new Intl.NumberFormat("en-GB",{style:"currency",currency:form.currency}).format(form.monthlyPriceMinor/100)} /mo</h3>
    {perks.slice(0,8).map((benefit,i)=><p key={i} style={{margin:"7px 0"}}>✓ {benefit}</p>)}
    <span className="button primary" style={{marginTop:12}}>{form.marketing.cta||"Choose plan"} →</span>
   </div>
   <p className="help">Marketing descriptions do not grant permissions. The feature switches below define real customer access. Describe only what you have actually enabled.</p>
  </div>}
  {tab==="billing"&&<div className="stack" style={{marginTop:18}}>
   <div className="field"><label htmlFor="plan-description">Internal description</label><input id="plan-description" value={form.description} onChange={e=>change("description",e.target.value)}/></div>
   <div className="form-grid">
    <div className="field"><label htmlFor="ps-monthly">Default monthly price ({form.currency})</label><input id="ps-monthly" type="number" min="0" step="0.01" value={form.monthlyPriceMinor/100} onChange={e=>change("monthlyPriceMinor",Math.round(Number(e.target.value)*100))}/></div>
    <div className="field"><label htmlFor="ps-annual">Default annual price ({form.currency})</label><input id="ps-annual" type="number" min="0" step="0.01" value={form.annualPriceMinor/100} onChange={e=>change("annualPriceMinor",Math.round(Number(e.target.value)*100))}/></div>
    <div className="field"><label htmlFor="ps-currency">Billing currency</label><select id="ps-currency" value={form.currency} onChange={e=>change("currency",e.target.value)}>{["GBP","USD","EUR"].map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="field"><label htmlFor="ps-currencies">Supported currencies</label><input id="ps-currencies" value={form.supportedBillingCurrencies.join(", ")} onChange={e=>change("supportedBillingCurrencies",e.target.value.toUpperCase().split(",").map(x=>x.trim()).filter(Boolean))}/></div>
    <div className="field"><label htmlFor="ps-trial">Free trial (days)</label><input id="ps-trial" type="number" min="0" value={form.trialDays} onChange={e=>change("trialDays",Number(e.target.value))}/></div>
    <div className="field"><label htmlFor="ps-discount">Annual discount (%)</label><input id="ps-discount" type="number" min="0" max="100" step="0.01" value={form.annualDiscountBps/100} onChange={e=>change("annualDiscountBps",Math.round(Number(e.target.value)*100))}/></div>
   </div>
   <h3>Payment providers</h3>
   <label className="toggle-row"><input type="checkbox" checked={form.paymentMethods.includes("STRIPE")} onChange={()=>toggleProvider("STRIPE")}/>Stripe — website checkout and webhook supported</label>
   <label className="toggle-row"><input type="checkbox" checked={form.paymentMethods.includes("PAYPAL")} onChange={()=>toggleProvider("PAYPAL")}/>PayPal — configure now; checkout integration not yet connected</label>
   <p className="help">New plans create public display-price rows from these defaults. For existing plans, update live currency-specific amounts using the Plan price by currency editor below. Provider credentials are managed under Admin Settings, not stored in plan copy. Stripe Price IDs and future PayPal Plan IDs are configured separately for each currency and billing period below this editor. Unconnected gateways never appear as working payment buttons.</p>
  </div>}
  {tab==="features"&&<div className="stack" style={{marginTop:18}}>
   <div className="field"><label htmlFor="ps-limit">Maximum active strategies (blank means unlimited)</label><input id="ps-limit" type="number" min="1" value={form.maxActiveStrategies??""} onChange={e=>change("maxActiveStrategies",e.target.value?Number(e.target.value):null)}/></div>
   <h3>Included features</h3>
   <div className="form-grid">{featureOptions.map(([key,label])=><label className="toggle-row" key={key}><input type="checkbox" checked={form.entitlements.features.includes(key)} onChange={()=>toggle("features",key)}/>{label}</label>)}</div>
   <h3>Notifications</h3>
   <label className="toggle-row"><input type="checkbox" checked readOnly disabled/>In-app (always available)</label>
   <div className="form-grid">{channelOptions.map(([key,label])=><label className="toggle-row" key={key}><input type="checkbox" checked={form.entitlements.notificationChannels.includes(key)} onChange={()=>toggle("notificationChannels",key)}/>{label}</label>)}</div>
   <h3>Available strategies</h3>
   <label className="toggle-row"><input type="checkbox" checked={!form.availableStrategyKeys.length} onChange={()=>change("availableStrategyKeys",form.availableStrategyKeys.length?[]:strategies.map(x=>x.key))}/>All enabled, published strategies (unrestricted)</label>
   {form.availableStrategyKeys.length>0&&<div className="form-grid">{strategies.map(s=><label className="toggle-row" key={s.key}><input type="checkbox" checked={form.availableStrategyKeys.includes(s.key)} onChange={()=>toggleStrategy(s.key)}/>{s.name}{s.enabled?"":" (disabled)"}</label>)}</div>}
   <p className="help">Existing subscriptions are rechecked when entitlements change; incompatible active strategies are paused without rewriting the investment ledger.</p>
  </div>}
  <div style={{marginTop:22}}><button type="submit" className="button primary" disabled={busy||newBlocked}>{busy?"Saving…":"Save plan configuration"}</button>
   {newBlocked&&<p className="error">Plan creation unavailable.</p>}
   {message&&<p role="status" className={error?"error":"help"}>{message}</p>}
  </div>
 </form>;
}