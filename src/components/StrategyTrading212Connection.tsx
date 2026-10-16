"use client";
import {useEffect,useState,type FormEvent} from "react";

type Check={externalTradeId:string;ledgerEventId:string;status:string;reason:string;observedQuantity:string|null};
const STATUS_LABEL:Record<string,string>={NOT_SYNCED:"not checked yet",VERIFIED:"every linked trade matches the broker",
 NEEDS_RECONCILIATION:"some linked trades need attention",NO_LINKED_TRADES:"no linked trades to check yet",ERROR:"the last check failed"};
type Snapshot={
 connected:boolean;providerEnabled:boolean;environment?:"demo"|"live";
 accountRef?:string;accountCurrency?:string;lastSyncedAt?:string|null;
 status?:string;reconciliation?:{linkedTradeCount?:number;matched?:number;issues?:Check[];verified?:Array<{externalTradeId:string;observedQuantity:string|null}>};
};
export function StrategyTrading212Connection({strategyId}:{strategyId:string}){
 const [state,setState]=useState<Snapshot|null>(null);
 const [mode,setMode]=useState<"demo"|"live">("live");
 const [key,setKey]=useState("");
 const [secret,setSecret]=useState("");
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const path="/api/strategies/"+strategyId+"/broker-connect";
 async function refresh(){
  const res=await fetch(path,{cache:"no-store"});
  if(!res.ok)throw new Error("Could not load broker verification status.");
  setState(await res.json() as Snapshot);
 }
 useEffect(()=>{
  let cancelled=false;
  fetch(path,{cache:"no-store"}).then(async res=>{
   if(!res.ok)throw new Error("Status unavailable.");
   const status=await res.json() as Snapshot;
   if(!cancelled)setState(status);
  }).catch(()=>{if(!cancelled)setMessage("Broker connection status is unavailable.");});
  return ()=>{cancelled=true;};
 },[path]);
 async function run(method:"PUT"|"POST"|"DELETE",body?:object){
  setBusy(true);setMessage("");
  try{
   const url=method==="POST"?"/api/strategies/"+strategyId+"/broker-sync":path;
   const result=await fetch(url,{method,headers:{"content-type":"application/json"},
     ...(body?{body:JSON.stringify(body)}:{})});
   const info=await result.json().catch(()=>({}));
   if(!result.ok)throw new Error(String(info.error??"Broker request failed."));
   setKey("");setSecret("");setConsent(false);
   await refresh();
   setMessage(method==="PUT"?"Read-only connection saved. Assign exact broker trades before synchronising.":
     method==="DELETE"?"Broker access revoked from Wealtharr; your historical ledger is unchanged.":
     "Read-only verification complete. Any differences need your approval; no ledger entries were altered.");
  }catch(error){setMessage(error instanceof Error?error.message:"Broker request failed.");}
  finally{setBusy(false);}
 }
 return <section className="glass form-card" aria-label="Strategy-only Trading 212 verification">
  <h3>Verify this strategy with Trading 212 (optional)</h3>
  <p className="help">Connect a <strong>read-only</strong> Trading 212 Invest/Stocks ISA key. The provider key can see the wider brokerage account; Wealtharr only saves evidence from transactions you explicitly linked to this strategy. No orders are placed or cancelled, and the strategy ledger remains authoritative.</p>
  {state?.connected?<div>
   <p className="help">Connected to {state.environment==="demo"?"demo":"live"} account ending in {String(state.accountRef??"").slice(-4)} · {state.accountCurrency}.
     {state.lastSyncedAt?" Last checked "+new Date(state.lastSyncedAt).toLocaleString("en-GB")+".":" Not synchronised yet."}</p>
   <p className="help">Verification: {STATUS_LABEL[state.status??"NOT_SYNCED"]??state.status}. Linked transactions: {state.reconciliation?.linkedTradeCount??0}. Matched: {state.reconciliation?.matched??0}.</p>
   {state.reconciliation?.issues?.map(check=><p key={check.ledgerEventId} className="attention-message">
    Order {check.externalTradeId}: {check.status} — {check.reason}</p>)}
   {state.reconciliation?.verified?.map(check=><p key={check.externalTradeId} className="help">
    Verified linked order {check.externalTradeId}: {check.observedQuantity} units.</p>)}
   <div className="button-row">
    <button className="button primary" type="button" disabled={busy||!state.providerEnabled}
     onClick={()=>run("POST")}>{busy?"Checking…":"Verify linked orders"}</button>
    <button className="button" type="button" disabled={busy}
     onClick={()=>run("DELETE")}>Disconnect and delete stored broker credentials</button>
   </div>
  </div>:<form onSubmit={(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault();void run("PUT",{environment:mode,key,secret,readOnlyConsent:consent});
   }}>
   <div className="form-grid">
    <label className="field">Environment<select value={mode} onChange={e=>setMode(e.target.value as "demo"|"live")}>
     <option value="live">Live / real-money account</option><option value="demo">Demo account</option>
    </select></label>
    <label className="field">Read-only API key<input autoComplete="off" type="password" required minLength={8}
     value={key} onChange={e=>setKey(e.target.value)}/></label>
    <label className="field">Read-only API secret<input autoComplete="off" type="password" required minLength={8}
     value={secret} onChange={e=>setSecret(e.target.value)}/></label>
   </div>
   <label className="toggle-row"><input type="checkbox" checked={consent} required
    onChange={e=>setConsent(e.target.checked)}/>
    I generated these credentials with read-only permissions, understand the provider grants account-wide visibility, and authorise strategy-scoped verification only.
   </label>
   <button className="button primary" type="submit" disabled={busy||!state?.providerEnabled}>
    {busy?"Verifying…":"Connect read-only account"}</button>
  </form>}
  {state&&!state.providerEnabled&&<p className="help">Master Admin has disabled new Trading 212 API verification. Manual tracking and local CSV imports remain available.</p>}
  {message&&<p role="status" className="help">{message}</p>}
  <p className="help">First link individual Trading 212 order IDs using the local CSV selector in “Record a broker trade”. Use the numeric account reference verified by Trading 212. Orders without explicit links are ignored, even if they share the same ticker. Missing provider history remains unverified. No automatically inferred cash balance, dividends or cost basis.</p>
 </section>;
}
