"use client";
import {useState} from "react";

export type AccessRow={userId:string;key:string;allowed:boolean};
export function UserStrategyAccessEditor({users,strategies,initialOverrides}:{
  users:Array<{id:string;email:string}>;
  strategies:Array<{key:string;name:string}>;
  initialOverrides:AccessRow[];
}){
  const [overrides,setOverrides]=useState(initialOverrides);
  const [userId,setUserId]=useState(users[0]?.id??"");
  const [strategyKey,setStrategyKey]=useState(strategies[0]?.key??"");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const found=overrides.find(row=>row.userId===userId&&row.key===strategyKey);
  const current=found?(found.allowed?"ALLOW":"DENY"):"INHERIT";
  async function save(access:"ALLOW"|"DENY"|"INHERIT"){
    setBusy(true);setMessage("");
    try{
      const response=await fetch("/api/admin/user-strategy-access",{
        method:"PUT",headers:{"content-type":"application/json"},
        body:JSON.stringify({userId,strategyKey,access})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw new Error(String(payload.error??"Could not save access."));
      setOverrides(previous=>[
        ...previous.filter(row=>row.userId!==userId||row.key!==strategyKey),
        ...(access==="INHERIT"?[]:[{userId,key:strategyKey,allowed:access==="ALLOW"}])
      ]);
      setMessage(payload.enforcementPending
        ?"Access saved; recheck pending account enforcement in Operations.":
        "Access saved. "+Number(payload.paused??0)+" active strategy instance(s) paused.");
    }catch(error){setMessage(error instanceof Error?error.message:"Could not update access.");}
    finally{setBusy(false);}
  }
  return <section className="glass form-card" aria-label="Per-customer strategy access">
    <h2>Individual strategy access</h2>
    <p className="help">Overrides can block a customer or explicitly allow a strategy within their plan. They never bypass global availability, the subscription plan, country, ISA/SIPP/GIA eligibility or broker restrictions. Existing ledger history remains intact.</p>
    <div className="form-grid">
      <div className="field"><label htmlFor="user-strategy-customer">Customer</label>
        <select id="user-strategy-customer" value={userId} onChange={e=>{setUserId(e.target.value);setMessage("");}}>
          {users.map(u=><option key={u.id} value={u.id}>{u.email}</option>)}
        </select>
      </div>
      <div className="field"><label htmlFor="user-strategy-key">Strategy</label>
        <select id="user-strategy-key" value={strategyKey} onChange={e=>{setStrategyKey(e.target.value);setMessage("");}}>
          {strategies.map(s=><option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
      </div>
    </div>
    <p className="help">Current permission: <strong>{current==="INHERIT"?"Follow subscription plan":current==="ALLOW"?"Allowed within plan":"Blocked"}</strong></p>
    <div className="inline" style={{marginTop:12}}>
      <button type="button" className="button" disabled={busy||!userId||!strategyKey||current==="INHERIT"} onClick={()=>void save("INHERIT")}>Follow plan</button>
      <button type="button" className="button primary" disabled={busy||!userId||!strategyKey||current==="ALLOW"} onClick={()=>void save("ALLOW")}>Allow within plan</button>
      <button type="button" className="button" disabled={busy||!userId||!strategyKey||current==="DENY"} onClick={()=>void save("DENY")}>Block for user</button>
    </div>
    {message&&<p className="help" role="status">{message}</p>}
  </section>;
}
