"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";

type Entitlements={features:string[];notificationChannels:string[]};
type Config={
 slug:string;displayName:string;description:string;monthlyPriceMinor:number;annualPriceMinor:number;
 annualDiscountBps:number;currency:string;supportedBillingCurrencies:string[];
 maxActiveStrategies:number|null;availableStrategyKeys:string[];
 stripeMonthlyPriceId:string|null;stripeAnnualPriceId:string|null;entitlements:Entitlements;
 trialDays:number;visible:boolean;archived:boolean;sortOrder:number;
};
const featureOptions=[
 ["history","Transaction history"],["reconciliation","Broker reconciliation"],["resume","Resume existing investments"],
 ["community","Anonymous community stats"],["analytics","Advanced analytics"],["comparisons","Benchmark comparisons"],
 ["what_if","What-if analysis"],["advanced_imports","Advanced imports"],["multi_account","Multiple accounts per strategy"]
] as const;
const channelOptions=[["EMAIL","Email"],["DISCORD","Discord"],["TELEGRAM","Telegram"]] as const;
const blank:Config={
 slug:"",displayName:"",description:"",monthlyPriceMinor:0,annualPriceMinor:0,annualDiscountBps:0,
 currency:"GBP",supportedBillingCurrencies:["GBP"],maxActiveStrategies:1,availableStrategyKeys:[],
 stripeMonthlyPriceId:null,stripeAnnualPriceId:null,entitlements:{features:[],notificationChannels:[]},
 trialDays:0,visible:false,archived:false,sortOrder:50
};
function asStrings(raw:unknown):string[]{
 if(Array.isArray(raw))return raw.filter((v):v is string=>typeof v==="string");
 try{if(typeof raw==="string")return asStrings(JSON.parse(raw));}catch{/* ignore */}
 return [];
}
function entitlements(raw:unknown):Entitlements{
 let parsed=raw;
 try{if(typeof parsed==="string")parsed=JSON.parse(parsed);}catch{/* unconfigured */}
 const data=parsed&&typeof parsed==="object"&&!Array.isArray(parsed)?parsed as Record<string,unknown>:{};
 return {features:asStrings(data.features),notificationChannels:asStrings(data.notificationChannels)};
}
export function SimplePlanEditor({initialPlans,strategies}:{initialPlans:Config[];strategies:Array<{key:string;name:string;enabled:boolean}>}){
 const router=useRouter();
 const [selection,setSelection]=useState(initialPlans[0]?.slug??"new");
 const [form,setForm]=useState<Config>(()=>initialPlans[0]?{...initialPlans[0],entitlements:entitlements(initialPlans[0].entitlements)}:{...blank});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 function choose(slug:string){
  setSelection(slug);setMessage("");
  const picked=initialPlans.find(p=>p.slug===slug);
  setForm(picked?{...picked,entitlements:entitlements(picked.entitlements)}:{...blank,entitlements:{features:[],notificationChannels:[]}});
 }
 function change<K extends keyof Config>(key:K,value:Config[K]){setForm(old=>({...old,[key]:value}));}
 function toggle(kind:keyof Entitlements,key:string){
  setForm(old=>{const set=new Set(old.entitlements[kind]);if(set.has(key))set.delete(key);else set.add(key);
    return {...old,entitlements:{...old.entitlements,[kind]:[...set]}};});
 }
 function toggleStrategy(key:string){
  setForm(old=>{const set=new Set(old.availableStrategyKeys);if(set.has(key))set.delete(key);else set.add(key);
   return {...old,availableStrategyKeys:[...set]};});
 }
 const restricted=form.availableStrategyKeys.length>0;
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();setBusy(true);setMessage("");
  try{
    const result=await fetch("/api/admin/plans",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(form)});
    const data=await result.json().catch(()=>({}));
    if(!result.ok)throw new Error(data.error??"Could not save this plan.");
    setMessage(data.enforcementFailures?"Plan saved, but "+data.enforcementFailures+" existing subscribers could not be rechecked. Inspect worker health.":"Plan saved. Existing subscribers were rechecked.");
    router.refresh();
  }catch(error){setMessage(error instanceof Error?error.message:"Could not save plan.");}
  finally{setBusy(false);}
 }
 return <form className="glass form-card" onSubmit={save}>
  <h2>Plan configuration</h2>
  <p className="help">Choose a plan and configure it without JSON. Changes to limits can pause affected strategies; their history remains intact.</p>
  <div className="field"><label htmlFor="admin-plan-select">Edit existing or add new</label>
   <select id="admin-plan-select" value={selection} onChange={e=>choose(e.target.value)}>
    {initialPlans.map(p=><option key={p.slug} value={p.slug}>{p.displayName} ({p.slug})</option>)}
    <option value="new">+ New plan</option>
   </select>
  </div>
  <div className="form-grid">
   <div className="field"><label htmlFor="admin-plan-slug">Plan ID</label><input id="admin-plan-slug" value={form.slug} readOnly={selection!=="new"} required pattern="[a-z][a-z0-9-]*" onChange={e=>change("slug",e.target.value.toLowerCase())}/></div>
   <div className="field"><label htmlFor="admin-plan-name">Display name</label><input id="admin-plan-name" value={form.displayName} required onChange={e=>change("displayName",e.target.value)}/></div>
   <div className="field full"><label htmlFor="admin-plan-description">Description</label><input id="admin-plan-description" value={form.description} onChange={e=>change("description",e.target.value)}/></div>
   <div className="field"><label htmlFor="admin-plan-monthly">Default monthly ({form.currency})</label><input id="admin-plan-monthly" type="number" min="0" step=".01" value={form.monthlyPriceMinor/100} onChange={e=>change("monthlyPriceMinor",Math.round(Number(e.target.value)*100))}/></div>
   <div className="field"><label htmlFor="admin-plan-annual">Default annual ({form.currency})</label><input id="admin-plan-annual" type="number" min="0" step=".01" value={form.annualPriceMinor/100} onChange={e=>change("annualPriceMinor",Math.round(Number(e.target.value)*100))}/></div>
   <div className="field"><label htmlFor="admin-plan-currency">Default currency</label><select id="admin-plan-currency" value={form.currency} onChange={e=>change("currency",e.target.value)}>{["GBP","USD","EUR"].map(c=><option key={c}>{c}</option>)}</select></div>
   <div className="field"><label htmlFor="admin-plan-currencies">Billing currencies</label><input id="admin-plan-currencies" value={form.supportedBillingCurrencies.join(", ")} onChange={e=>change("supportedBillingCurrencies",e.target.value.toUpperCase().split(",").map(s=>s.trim()).filter(Boolean))}/></div>
   <div className="field"><label htmlFor="admin-plan-limit">Maximum active strategies (blank = unlimited)</label><input id="admin-plan-limit" type="number" min="1" value={form.maxActiveStrategies??""} onChange={e=>change("maxActiveStrategies",e.target.value?Number(e.target.value):null)}/></div>
   <div className="field"><label htmlFor="admin-plan-trial">Trial days</label><input id="admin-plan-trial" type="number" min="0" value={form.trialDays} onChange={e=>change("trialDays",Number(e.target.value))}/></div>
  </div>
  <h3>Included features</h3>
  <div className="form-grid">{featureOptions.map(([key,label])=><label className="toggle-row" key={key}><input type="checkbox" checked={form.entitlements.features.includes(key)} onChange={()=>toggle("features",key)}/><span>{label}</span></label>)}</div>
  <h3>Notifications</h3>
  <div className="form-grid">{channelOptions.map(([key,label])=><label className="toggle-row" key={key}><input type="checkbox" checked={form.entitlements.notificationChannels.includes(key)} onChange={()=>toggle("notificationChannels",key)}/><span>{label}</span></label>)}</div>
  <h3>Available curated strategies</h3>
  <label className="toggle-row"><input type="checkbox" checked={!restricted} onChange={()=>change("availableStrategyKeys",restricted?[]:strategies.map(s=>s.key))}/><span>All enabled and published strategies</span></label>
  {restricted&&<div className="form-grid">{strategies.map(s=><label className="toggle-row" key={s.key}><input type="checkbox" checked={form.availableStrategyKeys.includes(s.key)} onChange={()=>toggleStrategy(s.key)}/><span>{s.name}{s.enabled?"":" (disabled)"}</span></label>)}</div>}
  <div className="form-grid">
   <label className="toggle-row"><input type="checkbox" checked={form.visible} onChange={e=>change("visible",e.target.checked)}/><span>Visible to customers</span></label>
   <label className="toggle-row"><input type="checkbox" checked={form.archived} onChange={e=>change("archived",e.target.checked)}/><span>Archived (unavailable for new subscriptions)</span></label>
  </div>
  <details><summary>Advanced billing defaults</summary><div className="form-grid">
   <div className="field"><label htmlFor="admin-plan-discount">Annual discount (%)</label><input id="admin-plan-discount" type="number" min="0" max="100" step=".01" value={form.annualDiscountBps/100} onChange={e=>change("annualDiscountBps",Math.round(Number(e.target.value)*100))}/></div>
   <div className="field"><label htmlFor="admin-plan-order">Display order</label><input id="admin-plan-order" type="number" value={form.sortOrder} onChange={e=>change("sortOrder",Number(e.target.value))}/></div>
   </div><p className="help">For Stripe, configure each billing-currency Price ID using the pricing editor alongside this form.</p></details>
  <button type="submit" className="button primary" disabled={busy}>{busy?"Saving…":"Save plan"}</button>
  {message&&<p role="status" className="help">{message}</p>}
 </form>;
}
