"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {CuratedStrategyToggle} from "@/components/CuratedStrategyToggle";

export type CatalogEntry = {
 key:string;name:string;family:string;engine:string;enabled:boolean;methodComplete:boolean;marketEligible:boolean;
 version:string|null;status:"ENABLED"|"READY"|"NO_RELEASE"|"NO_SIGNOFF"|"NO_MARKET"|"NEEDS_REVIEW"|"RESEARCH";
 reason:string;rules:string|null;
};
const filters=[{key:"all",name:"All strategies"},{key:"ready",name:"Live / eligible"},{key:"review",name:"Not available"}] as const;
export function AdminStrategyInventory({entries}:{entries:CatalogEntry[]}){
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState<(typeof filters)[number]["key"]>("all");
 const [bulkBusy,setBulkBusy]=useState(false);
 const [bulkResult,setBulkResult]=useState("");
 const router=useRouter();
 const eligible=entries.filter(s=>s.status==="READY"&&!s.enabled);
 const visible=useMemo(()=>entries.filter(s=>{
   const text=(s.name+" "+s.key+" "+s.family+" "+s.engine).toLowerCase();
   if(!text.includes(query.trim().toLowerCase()))return false;
   if(filter==="ready")return s.status==="READY"||s.status==="ENABLED";
   if(filter==="review")return s.status!=="READY"&&s.status!=="ENABLED";
   return true;
 }),[entries,filter,query]);
 async function enableEligible(){
   if(!eligible.length)return;
   setBulkBusy(true);setBulkResult("");
   let updated=0;const failures:string[]=[];
   for(const s of eligible){
     try{
       const response=await fetch("/api/admin/strategies",{
         method:"PATCH",headers:{"content-type":"application/json"},
         body:JSON.stringify({action:"TOGGLE_DEFINITION",strategyKey:s.key,enabled:true})
       });
       const payload=await response.json().catch(()=>({}));
       if(!response.ok)throw new Error(String(payload.error??"Unavailable"));
       updated++;
     }catch(error){failures.push(s.name+": "+(error instanceof Error?error.message:"Failed"));}
   }
   setBulkResult(updated+" enabled."+ (failures.length?" "+failures.length+" blocked: "+failures.join("; "):""));
   setBulkBusy(false);
   router.refresh();
 }
 const enabled=entries.filter(s=>s.enabled).length;
 const complete=entries.filter(s=>s.methodComplete).length;
 const markets=entries.filter(s=>s.marketEligible).length;
 const awaiting=entries.filter(s=>s.status!=="ENABLED"&&s.status!=="READY").length;
 return <section className="admin-catalogue">
   <div className="admin-stats-strip" aria-label="Catalogue overview">
     <div><span>Registered profiles</span><strong>{entries.length}</strong><small>Admin inventory</small></div>
     <div><span>Method complete</span><strong>{complete}</strong><small>Code-verified rules</small></div>
     <div><span>Market eligible</span><strong>{markets}</strong><small>At least one verified market</small></div>
     <div><span>Globally enabled</span><strong>{enabled}</strong><small>Customer access has additional gates</small></div>
   </div>
   <div className="admin-catalogue-toolbar">
     <div><h2>Strategy Studio catalogue</h2><p>Explore every reference profile. Customer availability is controlled by global toggles, plans, customer access and exact account instrument eligibility.</p></div>
     <button type="button" className="button primary" disabled={!eligible.length||bulkBusy} onClick={enableEligible}>{bulkBusy?"Checking releases…":"Enable all eligible ("+eligible.length+")"}</button>
   </div>
   {bulkResult&&<p className="admin-catalogue-result" role="status">{bulkResult}</p>}
   <div className="admin-catalogue-search-row">
     <label className="admin-search"><span className="sr-only">Search strategies</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by strategy, engine or family…" /></label>
     <div className="admin-catalogue-filters" role="group" aria-label="Filter strategies">{filters.map(option=>
       <button key={option.key} type="button" className={filter===option.key?"selected":""} aria-pressed={filter===option.key} onClick={()=>setFilter(option.key)}>{option.name}</button>
     )}</div>
   </div>
   <div className="admin-studio-table-wrap" role="region" aria-label="Strategy Studio catalogue" tabIndex={0}>
    <table className="admin-studio-table">
     <thead><tr><th scope="col">STRATEGY</th><th scope="col">RELEASE</th><th scope="col">ENGINE</th><th scope="col">ACTION</th></tr></thead>
     <tbody>{visible.map(s=>{
      const live=s.status==="ENABLED",ready=s.status==="READY";
      const statusLabel=live?"Enabled":ready?"Ready":s.status==="RESEARCH"?"Research":s.status==="NO_RELEASE"?"Unverified":s.status==="NO_SIGNOFF"?"Review needed":s.status==="NO_MARKET"?"Mapping missing":"Review needed";
      const reviewHref=s.status==="RESEARCH"?"/admin/strategies/research":"/admin/strategies#release-workflow";
      return <tr key={s.key}>
       <td><strong className="admin-studio-strategy-name">{s.name}</strong><small>{s.family.replaceAll("_"," ")} · {s.version?"v"+s.version:"No published version"}</small></td>
       <td><span className={"admin-studio-release-state"+(live?" is-live":ready?" is-ready":" is-review")}>{statusLabel}</span>
        <small>{s.reason}</small></td>
       <td className="admin-studio-engine">{s.engine.replaceAll("_"," ")}</td>
       <td>{ready||live?<CuratedStrategyToggle strategyKey={s.key} enabled={s.enabled}/>:
        <Link href={reviewHref} className="admin-studio-action">{s.status==="RESEARCH"?"Inspect":"Configure"} <span aria-hidden="true">→</span></Link>}</td>
      </tr>;
     })}</tbody>
    </table>
    {!visible.length&&<p className="admin-empty-catalogue">No strategies match that search. Try another name or filter.</p>}
   </div>
 </section>;
}
