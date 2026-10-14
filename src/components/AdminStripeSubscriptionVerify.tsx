"use client";
import {useState} from "react";
type Result={
 outcome:"MATCH"|"REVIEW"|"UNVERIFIED";
 reason:"IDENTITY_UNVERIFIED"|"FIELDS_DIFFER"|"CONSISTENT";
 checks:Array<{field:"status"|"plan"|"cadence"|"period"|"cancellation";matched:boolean}>;
 comparedAt:string;note:string;
};
const labels:Record<Result["checks"][number]["field"],string>={
 status:"Subscription status",plan:"Provider price maps to local plan",
 cadence:"Billing cadence",period:"Recorded period end",cancellation:"Scheduled cancellation"
};
export function AdminStripeSubscriptionVerify({userId}:{userId:string}){
 const [result,setResult]=useState<Result|null>(null);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState(false);
 async function compare(){
  if(busy)return;
  setBusy(true);setError("");setResult(null);
  try{
   const response=await fetch("/api/admin/users/subscription-verify",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({userId}),cache:"no-store"
   });
   const data=await response.json() as Result&{error?:string};
   if(!response.ok)throw new Error(data.error??"Could not compare recorded subscription.");
   setResult(data);
  }catch(e){setError(e instanceof Error?e.message:"Subscription comparison failed.");}
  finally{setBusy(false);}
 }
 return <section className="admin-design-panel" style={{marginTop:20}} aria-labelledby="admin-subscription-verify-title">
  <header className="admin-design-panel-header"><div>
   <h2 id="admin-subscription-verify-title">Compare with Stripe</h2>
   <p>On-demand, read-only check against Stripe for this customer. No subscription, payments or access records will be changed.</p>
  </div></header>
  <button className="button primary" type="button" disabled={busy} onClick={()=>void compare()}>
   {busy?"Comparing…":"Check current Stripe subscription"}
  </button>
  {error&&<p role="alert" className="admin-data-caveat">{error}</p>}
  {result&&<div aria-live="polite" role="status">
   <p><strong>{result.outcome==="MATCH"?"Recorded fields match Stripe":
    result.outcome==="REVIEW"?"Differences require operator review":"Stripe ownership could not be verified"}</strong></p>
   {result.reason==="IDENTITY_UNVERIFIED"&&<p className="admin-data-caveat">Ownership identifiers do not agree. No provider details are revealed.</p>}
   {result.checks.length>0&&<div role="list">{result.checks.map(check=>
    <div className="admin-design-info-row" role="listitem" key={check.field}>
     <span>{labels[check.field]}</span>
     <strong>{check.matched?"Matches":"Review"}</strong>
    </div>
   )}</div>}
   <p className="admin-data-caveat">Checked {new Date(result.comparedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC. {result.note}</p>
   <p className="admin-data-caveat">No payment settlement or refund verification is performed. Use the provider dashboard to resolve discrepancies, never update a plan based solely on this comparison.</p>
  </div>}
 </section>;
}
