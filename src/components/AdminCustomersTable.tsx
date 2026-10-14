"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
import {filterAdminCustomerRows,type AdminCustomerRow,type CustomerQuickFilter} from "@/domain/admin-customer-filters";

export function AdminCustomersTable({rows}:{rows:AdminCustomerRow[]}){
 const [query,setQuery]=useState("");
 const [quick,setQuick]=useState<CustomerQuickFilter>("ALL");
 const [plan,setPlan]=useState("ALL");
 const plans=useMemo(()=>[...new Set(rows.map(row=>row.plan))].sort((a,b)=>a.localeCompare(b)),[rows]);
 const visible=useMemo(()=>filterAdminCustomerRows(rows,{query,quick,plan}),[rows,query,quick,plan]);
 return <section className="admin-design-panel admin-customer-panel">
  <div className="admin-design-panel-header"><div><h2>Customer directory</h2>
   <p>Most recently registered {rows.length} accounts. Search and filters apply only to these displayed records.</p></div>
   <label className="admin-customer-search"><span className="sr-only">Search displayed customers</span>
    <input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search email, plan or status"/></label>
  </div>
  <div className="inline" style={{marginBottom:16}}>
   <label htmlFor="admin-customer-quick">Focus</label>
   <select id="admin-customer-quick" value={quick} onChange={e=>setQuick(e.target.value as CustomerQuickFilter)}>
    <option value="ALL">All displayed customers</option>
    <option value="SUBSCRIBED">Active or trial subscriptions</option>
    <option value="STRATEGY_ATTENTION">Strategies needing attention</option>
    <option value="BILLING_ATTENTION">Billing status needing attention</option>
   </select>
   <label htmlFor="admin-customer-plan">Plan</label>
   <select id="admin-customer-plan" value={plan} onChange={e=>setPlan(e.target.value)}>
    <option value="ALL">All plans</option>{plans.map(name=><option value={name} key={name}>{name}</option>)}
   </select>
   <span role="status" aria-live="polite" className="admin-data-caveat">Showing {visible.length} of {rows.length} loaded records</span>
  </div>
  <div className="admin-studio-table-wrap" role="region" tabIndex={0} aria-label="Customer directory table">
   <table className="admin-studio-table"><thead><tr><th scope="col">CUSTOMER</th><th scope="col">PLAN</th><th scope="col">STATUS</th><th scope="col">STRATEGIES</th><th scope="col">REVIEW</th></tr></thead>
   <tbody>{visible.map(user=><tr key={user.email}>
    <td><strong>{user.id?<Link href={"/admin/users/"+user.id} aria-label={"Manage "+user.email}>{user.email}</Link>:user.email}</strong><small>{user.country} · {user.role}</small></td>
    <td>{user.plan}</td><td>{user.status}</td>
    <td>{user.active}</td><td>{user.attention>0?<span className="admin-studio-release-state is-review">{user.attention} need attention</span>:<span className="admin-studio-release-state is-live">No alerts</span>}</td>
   </tr>)}</tbody></table>
   {!visible.length&&<p className="admin-data-caveat">No loaded customer matches the current filters.</p>}
  </div>
 </section>;
}
