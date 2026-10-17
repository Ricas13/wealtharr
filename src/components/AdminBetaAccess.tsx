"use client";
import {useState} from "react";

export function AdminBetaAccess({userId,current}:{
 userId:string;current:{plan:string;expiresAt:string;active:boolean}|null
}){
 const[plan,setPlan]=useState<"investor"|"pro">("pro");
 const[days,setDays]=useState(90);
 const[busy,setBusy]=useState(false);
 const[message,setMessage]=useState("");
 async function change(action:"grant"|"revoke"){
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/admin/beta-access",{
    method:action==="grant"?"POST":"DELETE",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(action==="grant"?{userId,planSlug:plan,days}:{userId})
   });
   const data=await response.json().catch(()=>({error:"Invalid response"})) as {error?:string;enforcementPending?:boolean};
   if(!response.ok){setMessage(data.error??"Could not update beta access.");return;}
   setMessage(data.enforcementPending?"Saved; entitlement enforcement is pending.":"Saved complimentary beta access.");
   window.location.reload();
  }catch{setMessage("Could not reach the server.");}
  finally{setBusy(false);}
 }
 return <section className="admin-design-panel" aria-label="Complimentary private beta access" style={{marginTop:20}}>
  <header className="admin-design-panel-header"><div>
   <h2>Complimentary beta access</h2>
   <p>Grant access for a limited evaluation period. No Stripe charge, invoice or subscription is created.</p>
  </div></header>
  {current?.active?<p>Currently: <strong>{current.plan}</strong> through {new Date(current.expiresAt).toLocaleDateString("en-GB")}.</p>:<p>No active complimentary grant.</p>}
  <div className="inline">
   <label htmlFor="beta-access-plan">Plan</label>
   <select id="beta-access-plan" value={plan} onChange={e=>setPlan(e.target.value as "investor"|"pro")}>
    <option value="investor">Investor</option><option value="pro">Pro</option>
   </select>
   <label htmlFor="beta-access-days">Days</label>
   <input id="beta-access-days" type="number" min={7} max={180} value={days}
    onChange={e=>setDays(Number(e.target.value))}/>
   <button className="button primary" type="button" disabled={busy||!Number.isInteger(days)||days<7||days>180}
    onClick={()=>void change("grant")}>Grant complimentary access</button>
   {current?.active&&<button className="button" type="button" disabled={busy}
    onClick={()=>void change("revoke")}>Revoke</button>}
  </div>
  {message&&<p role="status">{message}</p>}
  <p className="admin-data-caveat">An actual paid subscription always takes precedence. This does not bypass global strategy publication, instrument eligibility or market-data accuracy requirements. Revocation and expiry pause features beyond the real plan limits without deleting the customer's ledger.</p>
 </section>;
}
