"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";

export function AdminPromotionForm(){
 const router=useRouter();
 const [email,setEmail]=useState("");
 const [confirmation,setConfirmation]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  if(busy||confirmation!=="PROMOTE TO ADMIN")return;
  setBusy(true);setError("");setMessage("");
  try{
   const response=await fetch("/api/admin/security/promote-admin",{
    method:"POST",cache:"no-store",headers:{"content-type":"application/json"},
    body:JSON.stringify({email:email.trim().toLowerCase(),confirmation})
   });
   const data=await response.json() as {ok?:boolean;error?:string;note?:string};
   if(!response.ok)throw new Error(data.error??"Could not grant administrator access.");
   setMessage(data.note??"Administrator role granted.");
   setEmail("");setConfirmation("");
   router.refresh();
  }catch(e){setError(e instanceof Error?e.message:"Could not grant administrator access.");}
  finally{setBusy(false);}
 }
 return <form onSubmit={submit} className="admin-design-panel" aria-labelledby="admin-promote-title">
  <header className="admin-design-panel-header"><div><h2 id="admin-promote-title">Add a second administrator</h2>
   <p>Promote an existing independently verified user, with their own two-step sign-in enabled. No new account is created.</p>
  </div></header>
  <p className="admin-data-caveat">This grants broad Admin access, including financial configuration. Confirm the recipient agrees before continuing. You must have used MFA to sign in within the last 10 minutes. Existing sessions for the promoted account will be revoked. A second admin can then independently approve high-risk corporate actions.</p>
  <div className="inline">
   <label htmlFor="promote-admin-email">Existing user's verified email</label>
   <input id="promote-admin-email" type="email" autoComplete="off" value={email} required maxLength={254}
    onChange={event=>setEmail(event.target.value)} placeholder="colleague@example.com"/>
  </div>
  <div className="inline">
   <label htmlFor="promote-admin-confirm">Type PROMOTE TO ADMIN</label>
   <input id="promote-admin-confirm" type="text" value={confirmation} autoComplete="off" required
    maxLength={16} onChange={event=>setConfirmation(event.target.value)}
    placeholder="PROMOTE TO ADMIN"/>
  </div>
  <button className="button primary" type="submit" disabled={busy||confirmation!=="PROMOTE TO ADMIN"||!email.trim()}>
   {busy?"Checking permissions…":"Grant administrator access"}
  </button>
  {error&&<p role="alert" className="admin-data-caveat">{error}</p>}
  {message&&<p role="status" aria-live="polite" className="admin-data-caveat">{message}</p>}
 </form>;
}
