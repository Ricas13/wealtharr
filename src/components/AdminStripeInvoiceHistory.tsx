"use client";
import {useState} from "react";
import {invoiceAmountMinor} from "@/domain/admin-stripe-invoices";

type Invoice={status:string;currency:string;amountPaidMinor:number;amountDueMinor:number;issuedAt:string};
type Reply={invoices:Invoice[];hasMore:boolean;nextCursor:string|null;note:string;error?:string};

export function AdminStripeInvoiceHistory({userId}:{userId:string}){
 const [invoices,setInvoices]=useState<Invoice[]>([]);
 const [loaded,setLoaded]=useState(false);
 const [more,setMore]=useState(false);
 const [cursor,setCursor]=useState<string|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 async function load(first=false){
  if(busy)return;
  setBusy(true);setError("");
  try{
   const response=await fetch("/api/admin/users/invoice-history",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({userId,...(!first&&cursor?{cursor}:{})}),cache:"no-store"
   });
   const data=await response.json() as Reply;
   if(!response.ok)throw new Error(data.error??"Invoice history is unavailable.");
   setInvoices(current=>first?data.invoices:[...current,...data.invoices]);
   setCursor(data.nextCursor);
   setMore(data.hasMore&&Boolean(data.nextCursor));
   setLoaded(true);
  }catch(e){setError(e instanceof Error?e.message:"Could not retrieve invoices.");}
  finally{setBusy(false);}
 }
 return <section className="admin-design-panel" style={{marginTop:20}} aria-labelledby="admin-invoice-history-title">
  <header className="admin-design-panel-header"><div><h2 id="admin-invoice-history-title">Stripe invoice history</h2>
   <p>Read-only, subscription-specific invoices from Stripe. Excludes other subscriptions on the same customer account.</p></div></header>
  <button className="button primary" disabled={busy} onClick={()=>void load(true)}>
   {busy?"Retrieving…":loaded?"Refresh invoices":"View Stripe invoices"}
  </button>
  {error&&<p role="alert" className="admin-data-caveat">{error}</p>}
  {loaded&&<div aria-live="polite">
   {invoices.length?<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Stripe subscription invoice history">
    <table className="admin-studio-table"><thead><tr><th scope="col">ISSUED (UTC)</th><th scope="col">STRIPE STATUS</th>
     <th scope="col">AMOUNT DUE</th><th scope="col">AMOUNT PAID</th></tr></thead>
     <tbody>{invoices.map((item,i)=><tr key={item.issuedAt+":"+i}>
      <td>{new Date(item.issuedAt).toLocaleString("en-GB",{timeZone:"UTC"})} UTC</td>
      <td>{item.status}</td><td>{invoiceAmountMinor(item.amountDueMinor,item.currency)}</td>
      <td>{invoiceAmountMinor(item.amountPaidMinor,item.currency)}</td>
     </tr>)}</tbody>
    </table></div>:<p className="admin-data-caveat">No invoices found for this linked Stripe subscription.</p>}
   {more&&<button className="button" disabled={busy} onClick={()=>void load(false)}>
    {busy?"Loading…":"Load 20 more invoices"}
   </button>}
   <p className="admin-data-caveat">Invoice statuses and amounts are current Stripe observations. This is not a net-revenue calculation, refund reconciliation or proof that funds reached your bank. No payment operations are available here.</p>
  </div>}
 </section>;
}
