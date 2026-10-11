"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Only toggles an existing, code-curated strategy. It never edits its rules or allocations. */
export function CuratedStrategyToggle({strategyKey,enabled}:{strategyKey:string;enabled:boolean}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  return <div className="stack">
    <button type="button" className="button compact" disabled={busy} aria-label={(enabled?"Disable ":"Enable ")+strategyKey}
      onClick={async()=>{
        setBusy(true);setError("");
        try{
          const response=await fetch("/api/admin/strategies",{method:"PATCH",
            headers:{"content-type":"application/json"},body:JSON.stringify({action:"TOGGLE_DEFINITION",strategyKey,enabled:!enabled})});
          const data=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(data.error??"Could not change availability.");
          router.refresh();
        }catch(e){setError(e instanceof Error?e.message:"Could not update strategy.");}
        finally{setBusy(false);}
      }}>{busy?"Updating…":enabled?"Disable":"Enable"}</button>
    {error&&<span className="error" role="alert">{error}</span>}
  </div>;
}
