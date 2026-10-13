"use client";
import {useState} from "react";
import {TurnstileChallenge} from "@/components/TurnstileChallenge";

/** Guided in-dashboard test. The secret never leaves the server. */
export function TurnstileAdminTest({siteKey,secretConfigured}:{siteKey:string;secretConfigured:boolean}){
  const [token,setToken]=useState("");
  const [epoch,setEpoch]=useState(0);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const ready=Boolean(siteKey)&&secretConfigured;
  async function test(){
    if(!ready||!token)return;
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/admin/turnstile/test",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token})
      });
      const result=await response.json() as {ok?:boolean;error?:string};
      setMessage(response.ok&&result.ok?
        "Verified: Cloudflare accepted this widget, hostname and matching saved secret.":
        result.error??"Verification did not succeed.");
    }catch{setMessage("Could not reach the verification service.");}
    finally{setToken("");setEpoch(n=>n+1);setBusy(false);}
  }
  return <div className="stack">
    <h4>Test your saved configuration</h4>
    <p className="help">First save both Cloudflare keys above. Then complete this real challenge and select Test connection. You can leave protection off until the test succeeds. The private key is never shown here.</p>
    {!ready?<p className="help" role="status">Save the site key and secret key to unlock the test.</p>:<>
      <TurnstileChallenge enabled siteKey={siteKey} action="admin-test" onTokenChange={setToken} resetCounter={epoch}/>
      <div className="inline"><button type="button" className="button" disabled={!token||busy} onClick={test}>{busy?"Testing…":"Test connection"}</button></div>
    </>}
    {message&&<p role="status" className="help">{message}</p>}
  </div>;
}
