"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MarkAllReadButton(){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  async function markAll(){
    setBusy(true);setFailed(false);
    try{
      const response=await fetch("/api/notifications/read",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({all:true})});
      if(!response.ok)throw new Error("failed");
      router.refresh();
    }catch{setFailed(true);}
    finally{setBusy(false);}
  }
  return <div className="inline"><button className="button compact" type="button" onClick={markAll} disabled={busy}>Mark all as read</button>{failed&&<span className="help" role="status">Could not update. Try again.</span>}</div>;
}
