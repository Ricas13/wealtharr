"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export function StripePriceSync({slug,currency,cadence,active,amountMinor}:{slug:string;currency:string;cadence:string;active:boolean;amountMinor:number}){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  return <div className="stack">
    <button type="button" className="button" disabled={busy||!active||!amountMinor||!["MONTHLY","ANNUAL"].includes(cadence)}
      onClick={async()=>{
        setBusy(true);setMessage("");
        try{
          const response=await fetch("/api/admin/plans/sync-stripe",{method:"POST",
            headers:{"content-type":"application/json"},body:JSON.stringify({planSlug:slug,currency,cadence})});
          const data=await response.json().catch(()=>({}));
          if(!response.ok)throw new Error(data.error??"Stripe price setup failed.");
          setMessage(data.created?"New Stripe price saved.":"Stripe price is already in sync.");
          router.refresh();
        }catch(e){setMessage(e instanceof Error?e.message:"Stripe price setup failed.");}
        finally{setBusy(false);}
      }}>{busy?"Syncing…":"Create / sync in Stripe"}</button>
    {message&&<small role="status">{message}</small>}
  </div>;
}
