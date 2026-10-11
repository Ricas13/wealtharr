"use client";
import { Field } from "@/components/Field";
import { useState } from "react";
import { useRouter } from "next/navigation";

function useAdminSubmit(url:string,method:"PUT"|"POST"|"PATCH"="PUT"){
  const router=useRouter();const[message,setMessage]=useState("");
  async function submit(payload:unknown){
    setMessage("");
    const response=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const body=await response.json().catch(()=>({}));
    if(!response.ok){setMessage(body.error??"Update failed.");return false;}
    setMessage("Saved.");router.refresh();return true;
  }
  return {submit,message};
}
function json(value:string,fallback:unknown){try{return value.trim()?JSON.parse(value):fallback;}catch{throw new Error("INVALID_JSON");}}

export function PlanEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/plans");
  const[error,setError]=useState("");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);try{await submit({
    slug:f.get("slug"),displayName:f.get("displayName"),description:f.get("description")??"",
    monthlyPriceMinor:Math.round(Number(f.get("monthly"))*100),annualPriceMinor:Math.round(Number(f.get("annual"))*100),annualDiscountBps:Math.round(Number(f.get("annualDiscount")||0)*100),
    currency:f.get("currency"),supportedBillingCurrencies:String(f.get("currencies")).split(",").map(x=>x.trim()).filter(Boolean),
    maxActiveStrategies:f.get("max")===""?null:Number(f.get("max")),availableStrategyKeys:String(f.get("strategies")).split(",").map(x=>x.trim()).filter(Boolean),
    stripeMonthlyPriceId:f.get("stripeMonthly")||null,stripeAnnualPriceId:f.get("stripeAnnual")||null,
    entitlements:json(String(f.get("entitlements")),{}),trialDays:Number(f.get("trial")||0),visible:Boolean(f.get("visible")),archived:Boolean(f.get("archived")),sortOrder:Number(f.get("sort")||0)
  });}catch{setError("Entitlements must be valid JSON.");}}}>
    <h3>Upsert plan</h3><div className="form-grid">
      <Field label="Slug"><input name="slug" required placeholder="investor"/></Field>
      <Field label="Display name"><input name="displayName" required placeholder="Investor"/></Field>
      <Field className="field full" label="Description"><input name="description"/></Field>
      <Field label="Monthly price"><input name="monthly" type="number" min="0" step="0.01" required/></Field>
      <Field label="Annual price"><input name="annual" type="number" min="0" step="0.01" required/></Field><Field label="Annual discount %"><input name="annualDiscount" type="number" min="0" max="100" step="0.01" defaultValue="0"/></Field>
      <Field label="Primary currency"><input name="currency" defaultValue="GBP" maxLength={3} required/></Field>
      <Field label="Supported currencies"><input name="currencies" defaultValue="GBP" placeholder="GBP,USD,EUR"/></Field>
      <Field label="Max active strategies"><input name="max" type="number" min="1" placeholder="blank = unlimited"/></Field>
      <Field label="Trial days"><input name="trial" type="number" min="0" defaultValue="0"/></Field>
      <Field className="field full" label="Available strategy keys"><input name="strategies" placeholder="blank = all enabled strategies"/></Field>
      <Field label="Stripe monthly Price ID"><input name="stripeMonthly"/></Field>
      <Field label="Stripe annual Price ID"><input name="stripeAnnual"/></Field>
      <Field className="field full" label="Entitlements JSON"><textarea name="entitlements" rows={4} defaultValue={'{"features":[],"notificationChannels":[]}'}/></Field>
      <div className="field"><label><input name="visible" type="checkbox" defaultChecked/> Visible</label></div>
      <div className="field"><label><input name="archived" type="checkbox"/> Archived</label></div>
      <Field label="Sort order"><input name="sort" type="number" defaultValue="0"/></Field>
    </div><button className="button primary" style={{marginTop:16}}>Save plan</button>{(error||message)&&<div className={error?"error":"success"}>{error||message}</div>}
  </form>;
}

export function StrategyDefinitionEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/strategies","PUT");const[error,setError]=useState("");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);try{await submit({
    key:f.get("key"),name:f.get("name"),family:f.get("family"),description:f.get("description")??"",engine:f.get("engine"),
    enabled:Boolean(f.get("enabled")),proprietary:Boolean(f.get("proprietary")),defaultBenchmarkKey:f.get("benchmark")||null,
    supportedRegions:String(f.get("regions")).split(",").map(x=>x.trim()).filter(Boolean),supportedWrappers:String(f.get("wrappers")).split(",").map(x=>x.trim()).filter(Boolean),
    requiredInputs:json(String(f.get("inputs")) ,[])
  });}catch{setError("Required inputs must be valid JSON.");}}}>
    <h3>Upsert strategy definition</h3><div className="form-grid">
      <Field label="Key"><input name="key" required/></Field><Field label="Name"><input name="name" required/></Field>
      <Field label="Family"><input name="family" required/></Field><Field label="Engine"><select name="engine"><option>VALUE_TARGET</option><option>FIXED_ALLOCATION</option></select></Field>
      <Field className="field full" label="Description"><input name="description"/></Field>
      <Field label="Regions"><input name="regions" defaultValue="GB,US,EU"/></Field><Field label="Wrappers"><input name="wrappers" defaultValue="ISA,SIPP,TAXABLE"/></Field>
      <Field label="Benchmark key"><input name="benchmark"/></Field><Field label="Required inputs JSON"><input name="inputs" defaultValue="[]"/></Field>
      <div className="field"><label><input type="checkbox" name="enabled"/> Enabled</label></div><div className="field"><label><input type="checkbox" name="proprietary"/> Proprietary</label></div>
    </div><button className="button primary" style={{marginTop:16}}>Save definition</button>{(error||message)&&<div className={error?"error":"success"}>{error||message}</div>}
  </form>;
}

export function StrategyVersionEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/strategies","POST");const[error,setError]=useState("");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);try{await submit({
    strategyKey:f.get("strategyKey"),version:f.get("version"),effectiveFrom:f.get("effectiveFrom"),effectiveTo:f.get("effectiveTo")||null,
    engineKey:f.get("engineKey")||undefined,upgradePolicy:f.get("upgradePolicy"),
    inputSchema:json(String(f.get("inputSchema")),[]),config:json(String(f.get("config")),{}),
    disclosure:f.get("disclosure")??"",releaseNotes:f.get("releaseNotes")??""
  });}catch{setError("Configuration and input schema must be valid JSON.");}}}>
    <h3>Create strategy release draft</h3><div className="form-grid">
      <Field label="Strategy key"><input name="strategyKey" required/></Field>
      <Field label="Version"><input name="version" placeholder="1.1" required/></Field>
      <Field label="Effective from"><input name="effectiveFrom" type="date" required/></Field>
      <Field label="Effective to"><input name="effectiveTo" type="date"/></Field>
      <Field label="Engine override"><select name="engineKey"><option value="">Use definition default</option><option>VALUE_TARGET</option><option>FIXED_ALLOCATION</option></select></Field>
      <Field label="Upgrade policy"><select name="upgradePolicy"><option>OPTIONAL</option><option>RECOMMENDED</option><option>REQUIRED</option></select></Field>
      <Field className="field full" label="Strategy-specific onboarding fields JSON"><textarea name="inputSchema" rows={5} defaultValue="[]"/></Field>
      <Field className="field full" label="Config JSON"><textarea name="config" rows={7} defaultValue="{}"/></Field>
      <Field className="field full" label="Release notes"><textarea name="releaseNotes" rows={3}/></Field>
      <Field className="field full" label="Disclosure"><textarea name="disclosure" rows={3}/></Field>
    </div><button className="button primary" style={{marginTop:16}}>Create draft</button>{(error||message)&&<div className={error?"error":"success"}>{error||message}</div>}
  </form>;
}

export function StrategyVersionManager(){
  const {submit,message}=useAdminSubmit("/api/admin/strategies","PATCH");const[error,setError]=useState("");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);const action=String(f.get("action"));try{
    if(action==="UPDATE_DRAFT")await submit({
      action,versionId:f.get("versionId"),effectiveFrom:f.get("effectiveFrom")||undefined,effectiveTo:f.get("effectiveTo")||undefined,
      engineKey:f.get("engineKey")||undefined,upgradePolicy:f.get("upgradePolicy")||undefined,
      inputSchema:String(f.get("inputSchema")).trim()?json(String(f.get("inputSchema")),[]):undefined,
      config:String(f.get("config")).trim()?json(String(f.get("config")),{}):undefined,
      disclosure:f.get("disclosure")||undefined,releaseNotes:f.get("releaseNotes")||undefined
    });
    else if(action==="ATTEST")await submit({
      action,versionId:f.get("versionId"),specCard:String(f.get("specCard")),goldenTests:String(f.get("goldenTests")),notes:String(f.get("attestNotes")||"")
    });
    else await submit({action,versionId:f.get("versionId")});
  }catch{setError("Draft configuration must be valid JSON.");}}}>
    <h3>Manage strategy release</h3><div className="form-grid">
      <Field className="field full" label="Version UUID"><input name="versionId" required/></Field>
      <Field label="Action"><select name="action"><option>UPDATE_DRAFT</option><option>ATTEST</option><option>PUBLISH</option><option>RETIRE</option></select></Field>
      <Field label="Engine override (draft only)"><select name="engineKey"><option value="">Keep current</option><option>VALUE_TARGET</option><option>FIXED_ALLOCATION</option></select></Field>
      <Field label="Effective from (draft only)"><input name="effectiveFrom" type="date"/></Field>
      <Field label="Effective to (draft only)"><input name="effectiveTo" type="date"/></Field>
      <Field label="Upgrade policy (draft only)"><select name="upgradePolicy"><option value="">Keep current</option><option>OPTIONAL</option><option>RECOMMENDED</option><option>REQUIRED</option></select></Field>
      <Field className="field full" label="Input schema JSON (blank = keep current)"><textarea name="inputSchema" rows={4}/></Field>
      <Field className="field full" label="Config JSON (blank = keep current)"><textarea name="config" rows={6}/></Field>
      <Field className="field full" label="Release notes (blank = keep current)"><textarea name="releaseNotes" rows={2}/></Field>
      <Field className="field full" label="Disclosure (blank = keep current)"><textarea name="disclosure" rows={2}/></Field>
      <Field label="Signed-off spec card (attest only)"><input name="specCard" placeholder="docs/strategy-specs/hfea.md"/></Field>
      <Field label="Golden tests (attest only)"><input name="goldenTests" placeholder="tests/golden/hfea.test.ts"/></Field>
      <Field className="field full" label="Attestation notes (attest only)"><textarea name="attestNotes" rows={2}/></Field>
    </div><button className="button primary" style={{marginTop:16}}>Apply release action</button>{(error||message)&&<div className={error?"error":"success"}>{error||message}</div>}
  </form>;
}

export function InstrumentEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/instruments");
  return <div className="detail-grid"><form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await submit({kind:"instrument",isin:f.get("isin")||null,providerInstrumentId:f.get("providerId")||null,name:f.get("name"),economicExposure:f.get("exposure"),leverage:String(f.get("leverage")),direction:"LONG",fundCurrency:f.get("fundCurrency")||null});}}><h3>Add instrument</h3><div className="stack"><Field label="Name"><input name="name" required/></Field><Field label="ISIN"><input name="isin"/></Field><Field label="Provider instrument ID"><input name="providerId"/></Field><Field label="Economic exposure"><input name="exposure" required/></Field><Field label="Leverage"><input name="leverage" defaultValue="1.000000" required/></Field><Field label="Fund currency"><input name="fundCurrency"/></Field><button className="button primary">Add instrument</button></div></form>
  <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await submit({kind:"mapping",economicExposure:f.get("exposure"),leverage:String(f.get("leverage")),direction:"LONG",country:f.get("country"),wrapper:f.get("wrapper"),broker:f.get("broker")||null,preferredCurrency:f.get("currency")||null,tradingLineId:f.get("tradingLineId"),fidelity:"EXACT",effectiveFrom:f.get("effectiveFrom"),effectiveTo:f.get("effectiveTo")||null,enabled:true});}}><h3>Add exact regional mapping</h3><div className="stack"><Field label="Exposure"><input name="exposure" required/></Field><Field label="Leverage"><input name="leverage" defaultValue="1.000000" required/></Field><Field label="Country"><input name="country" defaultValue="GB" maxLength={2} required/></Field><Field label="Wrapper"><input name="wrapper" defaultValue="ISA" required/></Field><Field label="Broker (optional)"><input name="broker"/></Field><Field label="Preferred currency"><input name="currency" defaultValue="GBP"/></Field><Field label="Trading line UUID"><input name="tradingLineId" required/></Field><Field label="Effective from"><input name="effectiveFrom" type="date" required/></Field><Field label="Effective to"><input name="effectiveTo" type="date"/></Field><button className="button primary">Add mapping</button></div></form>{message&&<div className="success">{message}</div>}</div>;
}

export function TradingLineEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/instruments");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await submit({kind:"tradingLine",instrumentId:f.get("instrumentId"),ticker:f.get("ticker"),exchange:f.get("exchange"),currency:f.get("currency"),exchangeTimezone:f.get("timezone"),providerSymbol:f.get("providerSymbol")||null,effectiveFrom:f.get("effectiveFrom"),effectiveTo:f.get("effectiveTo")||null});}}><h3>Add / update trading line</h3><div className="form-grid"><Field label="Instrument UUID"><input name="instrumentId" required/></Field><Field label="Ticker"><input name="ticker" required/></Field><Field label="Exchange"><input name="exchange" required/></Field><Field label="Currency"><input name="currency" defaultValue="GBP" required/></Field><Field label="Exchange timezone"><input name="timezone" defaultValue="Europe/London" required/></Field><Field label="Provider symbol"><input name="providerSymbol"/></Field><Field label="Effective from"><input name="effectiveFrom" type="date" required/></Field><Field label="Effective to"><input name="effectiveTo" type="date"/></Field></div><button className="button primary" style={{marginTop:16}}>Save trading line</button>{message&&<div className="success">{message}</div>}</form>;
}

export function FeatureFlagEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/feature-flags");const[error,setError]=useState("");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();setError("");const f=new FormData(e.currentTarget);try{await submit({key:f.get("key"),enabled:Boolean(f.get("enabled")),config:json(String(f.get("config")),{})});}catch{setError("Config must be valid JSON.");}}}><h3>Feature flag</h3><div className="form-grid"><Field label="Key"><input name="key" required/></Field><div className="field"><label><input name="enabled" type="checkbox"/> Enabled</label></div><Field className="field full" label="Config JSON"><input name="config" defaultValue="{}"/></Field></div><button className="button primary" style={{marginTop:16}}>Save flag</button>{(error||message)&&<div className={error?"error":"success"}>{error||message}</div>}</form>;
}


export function PlanPriceEditor(){
  const {submit,message}=useAdminSubmit("/api/admin/plan-prices");
  return <form className="glass form-card" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);await submit({
    planSlug:f.get("planSlug"),currency:String(f.get("currency")).toUpperCase(),cadence:f.get("cadence"),
    amountMinor:Math.round(Number(f.get("amount"))*100),stripePriceId:f.get("stripePriceId")||null,appleProductId:f.get("appleProductId")||null,googleProductId:f.get("googleProductId")||null,active:Boolean(f.get("active"))
  });}}>
    <h3>Plan price by currency</h3><div className="form-grid">
      <Field label="Plan slug"><input name="planSlug" placeholder="investor" required/></Field>
      <Field label="Currency"><input name="currency" defaultValue="GBP" maxLength={3} required/></Field>
      <Field label="Cadence"><select name="cadence"><option>MONTHLY</option><option>ANNUAL</option></select></Field>
      <Field label="Amount"><input name="amount" type="number" min="0" step="0.01" required/></Field>
      <Field className="field full" label="Stripe Price ID"><input name="stripePriceId" placeholder="price_..."/></Field>
      <Field label="App Store product ID"><input name="appleProductId" placeholder="com.example.pro.monthly"/></Field>
      <Field label="Google Play product ID"><input name="googleProductId" placeholder="pro_monthly"/></Field>
      <div className="field"><label><input name="active" type="checkbox" defaultChecked/> Active</label></div>
    </div><button className="button primary" style={{marginTop:16}}>Save price</button>{message&&<div className="success">{message}</div>}
  </form>;
}


export function ModelPerformanceEditor() {
  const { submit, message } = useAdminSubmit("/api/admin/model-performance");
  const [error, setError] = useState("");

  return <form className="glass form-card" onSubmit={async (e) => {
    e.preventDefault();
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const points = json(String(f.get("points")), []);
      const benchmarks = json(String(f.get("benchmarks")||"[]"), []);
      if (!Array.isArray(points) || !Array.isArray(benchmarks)) throw new Error("INVALID_JSON");
      await submit({
        strategyVersionId: f.get("strategyVersionId"),
        source: f.get("source") || "ADMIN",
        points,
        benchmarks
      });
    } catch {
      setError("Model points and benchmark series must be valid JSON arrays.");
    }
  }}>
    <h3>Canonical model / benchmark history</h3>
    <div className="stack">
      <Field label="Strategy version UUID"><input name="strategyVersionId" required /></Field>
      <Field label="Source label"><input name="source" defaultValue="ADMIN" /></Field>
      <Field label="Strategy model points JSON"><textarea name="points" rows={7} defaultValue={'[{"date":"2026-01-02","value":"100"}]'} /></Field>
      <Field label={<>Comparison benchmark series JSON <span className="optional">optional</span></>}><textarea name="benchmarks" rows={10} defaultValue={'[{"key":"qqq","name":"QQQ","economicExposure":"NASDAQ_100_1X_LONG","label":"QQQ","sortOrder":10,"defaultVisible":false,"points":[{"date":"2026-01-02","value":"100"}]},{"key":"3qqq","name":"3QQQ","economicExposure":"NASDAQ_100_3X_LONG","label":"3QQQ","sortOrder":20,"defaultVisible":false,"points":[{"date":"2026-01-02","value":"100"}]}]'} /></Field>
      <button className="button primary">Upload model & comparisons</button>
      <div className="help">Only licensed total-return benchmark histories with verified currency/FX metadata may appear on the Main dashboard. For VTI/SPY/QQQ imports add currency, provider, totalReturnAdjusted, commercialLicenceConfirmed, fxConversionVerified, and the canonical BENCHMARK_* exposure. Untagged uploads remain unavailable. Each comparison has its own independent index history. The customer chart replays the user&apos;s real deposits and withdrawals against every series, so DCA is compared like-for-like. Benchmark mappings are strategy-version specific rather than hard-coded to 9Sig.</div>
      {(error || message) && <div className={error ? "error" : "success"}>{error || message}</div>}
    </div>
  </form>;
}
