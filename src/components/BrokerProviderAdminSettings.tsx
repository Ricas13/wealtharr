"use client";
import {useState,type FormEvent} from "react";

type Props={initial:{enabled:boolean;maxHistoryPages:number;syncIntervalMinutes:number}};
export function BrokerProviderAdminSettings({initial}:Props){
 const [enabled,setEnabled]=useState(initial.enabled);
 const [maxPages,setMaxPages]=useState(initial.maxHistoryPages);
 const [interval,setIntervalMinutes]=useState(initial.syncIntervalMinutes);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function save(event:FormEvent<HTMLFormElement>){
  event.preventDefault();setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/feature-flags",{
    method:"PUT",headers:{"content-type":"application/json"},
    body:JSON.stringify({key:"broker_trading212_readonly",enabled,
      config:{maxHistoryPages:maxPages,syncIntervalMinutes:interval}})
   });
   const result=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(String(result.error??"Could not save provider configuration."));
   setMessage("Trading 212 read-only provider settings saved.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not save provider configuration.");}
  finally{setBusy(false);}
 }
 return <form onSubmit={save} className="glass form-card" aria-label="Trading 212 provider configuration">
  <h2>Trading 212 read-only verification</h2>
  <p className="help">Controls for optional strategy-scoped broker checks. API credentials belong to consenting customers and are encrypted in Wealtharr. Provider permissions must be read-only. The feature starts disabled and never places trades.</p>
  <label className="toggle-row">
   <input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>
   Allow customers to connect a Trading 212 read-only API account
  </label>
  <div className="form-grid">
   <label className="field">Maximum order history pages per manual check
    <input type="number" min={1} max={6} step={1} value={maxPages}
     onChange={e=>setMaxPages(Number(e.target.value))} required/>
    <small>Up to 50 orders per page, capped at six requests per minute per brokerage account. Incomplete history is never treated as verified.</small>
   </label>
   <label className="field">Verification freshness window (minutes)
    <input type="number" min={5} max={1440} step={1} value={interval}
     onChange={e=>setIntervalMinutes(Number(e.target.value))} required/>
    <small>After this time, previous verification is marked stale. This is not an automatic polling schedule.</small>
   </label>
  </div>
  <p className="help">Trading 212's official API is in beta and currently supports Invest and Stocks ISA. The key is account-scoped even though Wealtharr displays only confirmed strategy trades. Verify provider scope before enabling live accounts.</p>
  <button className="button primary" type="submit" disabled={busy||maxPages<1||maxPages>6||interval<5||interval>1440}>
   {busy?"Saving…":"Save broker settings"}
  </button>
  {message&&<p role="status" className="help">{message}</p>}
 </form>;
}
