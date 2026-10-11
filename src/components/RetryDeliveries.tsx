"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
export function RetryDeliveries(){
 const router=useRouter();
 const [channel,setChannel]=useState("ALL");
 const [busy,setBusy]=useState(false);
 const [includeDeadLetter,setIncludeDeadLetter]=useState(false);
 const [notice,setNotice]=useState("");
 return <form className="glass form-card" onSubmit={async event=>{
  event.preventDefault();setBusy(true);setNotice("");
  try{
   const response=await fetch("/api/admin/operations/retry-deliveries",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channel:channel==="ALL"?undefined:channel,limit:10,includeDeadLetter})});
   const body=await response.json().catch(()=>({}));
   if(!response.ok)throw new Error(body.error||"Retry request failed");
   setNotice(String(body.queued??0)+" failed notification deliveries queued for the next worker cycle. No message has been sent yet.");
   router.refresh();
  }catch(error){setNotice(error instanceof Error?error.message:"Retry request failed");}
  finally{setBusy(false);}
 }}>
  <h3>Retry failed notifications</h3><p className="help">Queue up to ten failed, still-valid deliveries. Already sent, cancelled and superseded action messages cannot be retried here.</p>
  <div className="field"><label htmlFor="retry-channel">Channel</label><select id="retry-channel" value={channel} onChange={e=>setChannel(e.target.value)}>
   <option value="ALL">All</option><option value="EMAIL">Email</option><option value="DISCORD">Discord</option><option value="TELEGRAM">Telegram</option>
  </select></div>
  <label className="toggle-row"><input type="checkbox" checked={includeDeadLetter} onChange={e=>setIncludeDeadLetter(e.target.checked)}/><span>Include dead-lettered deliveries (reset their attempt counter)</span></label>
  <button className="button primary" type="submit" disabled={busy}>{busy?"Queuing…":"Queue safe retries"}</button>
  {notice&&<p role="status" className="help">{notice}</p>}
 </form>;
}
