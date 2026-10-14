"use client";
import {useRef,useState,type FormEvent} from "react";

type Customer={email:string;country:string;role:string;plan:string;status:string};
type LookupResult={total:number;page:number;totalPages:number;customers:Customer[];error?:string};

export function AdminCustomerLookup(){
 const [query,setQuery]=useState("");
 const [searched,setSearched]=useState("");
 const [result,setResult]=useState<LookupResult|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const current=useRef<AbortController|null>(null);

 async function search(term:string,page:number){
  const cleaned=term.trim();
  if(cleaned.length<3||cleaned.length>100){
   setError("Enter 3–100 characters from the customer's email address.");
   return;
  }
  current.current?.abort();
  const controller=new AbortController();
  current.current=controller;
  setBusy(true);setError("");setResult(null);
  try{
   const response=await fetch("/api/admin/users/lookup",{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({emailQuery:cleaned,page}),signal:controller.signal,cache:"no-store"
   });
   const body=await response.json() as LookupResult;
   if(!response.ok)throw new Error(body.error??"Search failed.");
   if(current.current===controller){setSearched(cleaned);setResult(body);}
  }catch(e){
   if(current.current===controller&&!controller.signal.aborted)
    setError(e instanceof Error?e.message:"Search failed.");
  }finally{
   if(current.current===controller){current.current=null;setBusy(false);}
  }
 }

 function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  void search(query,1);
 }

 return <section className="admin-design-panel" aria-labelledby="admin-global-customer-title">
  <header className="admin-design-panel-header"><div>
   <h2 id="admin-global-customer-title">Find any registered customer</h2>
   <p>Search all non-deleted accounts by email, including customers outside the recent-directory limit.</p>
  </div></header>
  <form onSubmit={submit} className="inline">
   <label htmlFor="admin-global-customer-query">Customer email contains</label>
   <input id="admin-global-customer-query" type="search" value={query}
    placeholder="Enter at least 3 characters" minLength={3} maxLength={100}
    autoComplete="off" onChange={e=>setQuery(e.target.value)}/>
   <button className="button primary" type="submit" disabled={busy}>{busy?"Searching…":"Search all accounts"}</button>
  </form>
  <p className="admin-data-caveat">Search requests are sent privately to the Admin API, not included in the address bar. Results show account and plan details only, without holdings, payment identifiers or billing error text.</p>
  {error&&<p role="alert" className="error">{error}</p>}
  <div role="status" aria-live="polite">
   {busy&&<p className="admin-data-caveat">Searching the customer database…</p>}
   {result&&<p className="admin-data-caveat">Found {result.total} account{result.total===1?"":"s"} matching “{searched}”. Showing page {result.page} of {result.totalPages}.</p>}
  </div>
  {result&&result.customers.length>0&&<div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="All-customer lookup results">
   <table className="admin-studio-table"><thead><tr>
    <th scope="col">CUSTOMER</th><th scope="col">PLAN</th><th scope="col">SUBSCRIPTION STATUS</th>
   </tr></thead>
   <tbody>{result.customers.map(row=><tr key={row.email}>
    <td><strong>{row.email}</strong><small>{row.country} · {row.role}</small></td>
    <td>{row.plan}</td><td>{row.status}</td>
   </tr>)}</tbody></table>
  </div>}
  {result&&result.total===0&&<p className="admin-data-caveat">No matching registered customers were found.</p>}
  {result&&result.totalPages>1&&<div className="inline" aria-label="Customer search pages">
   <button type="button" className="button" disabled={busy||result.page<=1}
    onClick={()=>void search(searched,result.page-1)}>Previous</button>
   <span>Page {result.page} / {result.totalPages}</span>
   <button type="button" className="button" disabled={busy||result.page>=result.totalPages}
    onClick={()=>void search(searched,result.page+1)}>Next</button>
  </div>}
 </section>;
}
