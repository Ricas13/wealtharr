"use client";
import {useMemo,useState} from "react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {CuratedStrategyToggle} from "@/components/CuratedStrategyToggle";

export type CatalogEntry = {
 key:string;name:string;family:string;engine:string;enabled:boolean;
 version:string|null;status:"ENABLED"|"READY"|"NO_RELEASE"|"NO_SIGNOFF"|"NO_MARKET"|"NEEDS_REVIEW"|"RESEARCH";
 reason:string;rules:string|null;
};
const filters=[{key:"all",name:"All strategies"},{key:"ready",name:"Live / eligible"},{key:"review",name:"Needs review"}] as const;
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
 const enabled=entries.filter(s=>s.status==="ENABLED").length;
 const awaiting=entries.filter(s=>s.status!=="ENABLED"&&s.status!=="READY").length;
 return <section className="admin-catalogue">
   <div className="admin-stats-strip" aria-label="Catalogue overview">
     <div><span>Total profiles</span><strong>{entries.length}</strong><small>Visible to administrators</small></div>
     <div><span>Customer enabled</span><strong>{enabled}</strong><small>Live catalogue</small></div>
     <div><span>Eligible now</span><strong>{eligible.length}</strong><small>Can pass enable checks</small></div>
     <div><span>Review needed</span><strong>{awaiting}</strong><small>Not trade-ready</small></div>
   </div>
   <div className="admin-catalogue-toolbar">
     <div><h2>Strategy catalogue</h2><p>Explore every reference profile. Customer availability remains gated by verified releases and instruments.</p></div>
     <button type="button" className="button primary" disabled={!eligible.length||bulkBusy} onClick={enableEligible}>{bulkBusy?"Checking releases…":"Enable all verified ("+eligible.length+")"}</button>
   </div>
   {bulkResult&&<p className="admin-catalogue-result" role="status">{bulkResult}</p>}
   <div className="admin-catalogue-search-row">
     <label className="admin-search"><span className="sr-only">Search strategies</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by strategy, engine or family…" /></label>
     <div className="admin-catalogue-filters" role="group" aria-label="Filter strategies">{filters.map(option=>
       <button key={option.key} type="button" className={filter===option.key?"selected":""} aria-pressed={filter===option.key} onClick={()=>setFilter(option.key)}>{option.name}</button>
     )}</div>
   </div>
   <div className="admin-catalogue-grid">
     {visible.map(s=>{
       const live=s.status==="ENABLED";const ready=s.status==="READY";
       const statusLabel=live?"Enabled":ready?"Ready to enable":s.status==="RESEARCH"?"Research only":s.status==="NO_RELEASE"?"Release missing":s.status==="NO_SIGNOFF"?"Approval needed":s.status==="NO_MARKET"?"Markets missing":"Review needed";
       return <article className="admin-strategy-tile" key={s.key}>
         <div className="admin-tile-top"><span className="admin-tile-engine">{s.engine.replaceAll("_"," ")}</span><span className={"admin-tile-status "+(live?"is-live":ready?"is-ready":"is-review")}>{statusLabel}</span></div>
         <h3>{s.name}</h3>
         <div className="admin-tile-meta">{s.family.replaceAll("_"," ")} <span>·</span> {s.version?"Version "+s.version:"No published version"}</div>
         <p className="admin-tile-description">{s.rules??s.reason}</p>
         <p className="admin-tile-reason">{s.reason}</p>
         <div className="admin-tile-footer">
           {live||ready?<CuratedStrategyToggle strategyKey={s.key} enabled={s.enabled}/>:<Link href="/admin/strategies/research" className="admin-tile-link">Review research →</Link>}
           <span>{live?"In customer catalogue":ready?"Passes configuration preflight":"Admin preview only"}</span>
         </div>
       </article>;
     })}
     {!visible.length&&<div className="admin-empty-catalogue">No strategies match that search. Try another name or filter.</div>}
   </div>
 </section>;
}
