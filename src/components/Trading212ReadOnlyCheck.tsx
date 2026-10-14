"use client";
import {useState,type FormEvent} from "react";

type Result={result:"OBSERVED"|"AMBIGUOUS";linked:number;filled:number;needsReview:number;missing:number;checkedAt:string;note:string};
export function Trading212ReadOnlyCheck({strategyId}:{strategyId:string}){
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState("");
 const [result,setResult]=useState<Result|null>(null);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(loading)return;
  const form=event.currentTarget;
  const data=new FormData(form);
  setLoading(true);setError("");setResult(null);
  try{
   const response=await fetch("/api/strategies/"+strategyId+"/broker/verify",{
    method:"POST",cache:"no-store",headers:{"content-type":"application/json"},
    body:JSON.stringify({
     mode:String(data.get("mode")),brokerAccountId:String(data.get("brokerAccountId")).trim(),
     apiKey:String(data.get("apiKey")),apiSecret:String(data.get("apiSecret")),
     consent:data.get("consent")==="on"
    })
   });
   const body=await response.json() as Result&{error?:string};
   if(!response.ok)throw new Error(body.error??"Could not check Trading 212.");
   setResult(body);
  }catch(e){
   setError(e instanceof Error?e.message:"Read-only check failed.");
  }finally{
   // Never retain the raw key pair in client state or local storage.
   form.reset();
   setLoading(false);
  }
 }
 return <details className="glass form-card">
  <summary>Trading 212 — check linked trade IDs with a read-only key</summary>
  <p className="help">Optional one-time check. Create an API key with read-only permissions in Trading 212 and enter its key and secret below. Broker permissions may cover your whole Invest/ISA account, although Wealtharr only returns counts for transactions you previously linked to this strategy. No unrelated holdings or cash are displayed or saved. Your credentials are used for this request only and cleared from the form afterwards.</p>
  <form onSubmit={event=>void submit(event)}>
   <label className="field">Trading 212 environment
    <select name="mode" required defaultValue="live"><option value="live">Live account</option><option value="demo">Demo account</option></select>
   </label>
   <label className="field">Numeric broker account ID
    <input name="brokerAccountId" inputMode="numeric" pattern="[0-9]{1,20}" maxLength={20} required autoComplete="off"/>
   </label>
   <label className="field">Read-only API key
    <input name="apiKey" type="password" minLength={8} maxLength={512} required autoComplete="off"/>
   </label>
   <label className="field">Read-only API secret
    <input name="apiSecret" type="password" minLength={8} maxLength={512} required autoComplete="off"/>
   </label>
   <label className="field"><input name="consent" type="checkbox" required/>
    I understand Trading 212 may expose account-wide order history to the server for filtering, and confirm this key is read-only.
   </label>
   <button className="button" type="submit" disabled={loading}>{loading?"Checking…":"Check selected strategy trades"}</button>
  </form>
  {error&&<p role="alert" className="help">{error}</p>}
  {result&&<div role="status" aria-live="polite">
   <p className="help">{result.result==="AMBIGUOUS"?"Ambiguous broker order IDs — manual review required.":"Broker order history checked for assigned IDs."}</p>
   <p className="help">Linked IDs: {result.linked} · Found FILLED: {result.filled} · Non-filled / review: {result.needsReview} · Not found: {result.missing}</p>
   <p className="help">Checked {new Date(result.checkedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC. {result.note}</p>
   <p className="help">Not finding an ID is not evidence a transaction never occurred. Confirm any difference with your broker. Existing Wealtharr trades and rebalances are unchanged.</p>
  </div>}
 </details>;
}
