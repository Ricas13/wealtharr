"use client";
import {useMemo,useState} from "react";
type Row={email:string;country:string;role:string;plan:string;status:string;active:number;attention:number};
export function AdminCustomersTable({rows}:{rows:Row[]}){
 const [query,setQuery]=useState("");
 const visible=useMemo(()=>rows.filter(row=>
  [row.email,row.country,row.role,row.plan,row.status].some(t=>t.toLowerCase().includes(query.trim().toLowerCase()))),[rows,query]);
 return <section className="admin-design-panel admin-customer-panel">
  <div className="admin-design-panel-header"><div><h2>Customer directory</h2><p>Most recently registered {rows.length} accounts. Search filters only the displayed rows.</p></div>
   <label className="admin-customer-search"><span className="sr-only">Search displayed customers</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search email, plan or status"/></label>
  </div>
  <div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Customer directory table">
   <table className="admin-studio-table"><thead><tr><th scope="col">CUSTOMER</th><th scope="col">PLAN</th><th scope="col">STATUS</th><th scope="col">STRATEGIES</th><th scope="col">REVIEW</th></tr></thead>
   <tbody>{visible.map(user=><tr key={user.email}>
    <td><strong>{user.email}</strong><small>{user.country} · {user.role}</small></td>
    <td>{user.plan}</td><td>{user.status}</td>
    <td>{user.active}</td><td>{user.attention>0?<span className="admin-studio-release-state is-review">{user.attention} need attention</span>:<span className="admin-studio-release-state is-live">No alerts</span>}</td>
   </tr>)}</tbody></table>
   {!visible.length&&<p className="admin-data-caveat">No displayed customer matches your search.</p>}
  </div>
 </section>;
}
