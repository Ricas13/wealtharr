"use client";
import { Field } from "@/components/Field";
import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";

export function DiscordForm(){const[message,setMessage]=useState("");return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const r=await fetch("/api/settings/discord",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({webhook:f.get("webhook")})});const b=await r.json();setMessage(r.ok?"Discord webhook saved.":b.error);}}><Field label="Discord webhook"><input name="webhook" type="url" placeholder="https://discord.com/api/webhooks/..." required/></Field><button className="button">Save Discord webhook</button>{message&&<div className={message.startsWith("Discord webhook saved")?"success":"error"}>{message}</div>}</form>;}

type BillingPrice={
  planSlug:string;planName:string;currency:string;cadence:"MONTHLY"|"ANNUAL";amountMinor:number;
  maxActiveStrategies:number|null;entitlements:Record<string,unknown>;
};
function planSummary(prices:BillingPrice[],slug:string,currency:string){
  const rows=prices.filter((price)=>price.planSlug===slug&&price.currency===currency);
  const monthly=rows.find((price)=>price.cadence==="MONTHLY");
  const annual=rows.find((price)=>price.cadence==="ANNUAL");
  return {monthly,annual,meta:monthly??annual};
}
export function BillingButtons({
  prices,defaultCurrency,currentPlanSlug,paidSubscription,activeStrategyCount,currentMaxActiveStrategies
}:{
  prices:BillingPrice[];
  defaultCurrency:string;
  currentPlanSlug:string;
  paidSubscription:boolean;
  activeStrategyCount:number;
  currentMaxActiveStrategies:number|null;
}){
  const currencies=useMemo(()=>[...new Set(prices.map(p=>p.currency))],[prices]);
  const[currency,setCurrency]=useState(currencies.includes(defaultCurrency)?defaultCurrency:(currencies[0]??defaultCurrency));
  const[busy,setBusy]=useState("");
  const[error,setError]=useState("");

  async function checkout(planSlug:string,cadence:"monthly"|"annual"){
    setBusy(planSlug+cadence);setError("");
    const r=await fetch("/api/billing/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({planSlug,cadence,currency})});
    const b=await r.json();setBusy("");
    if(b.url)window.location.assign(b.url);else setError(b.error);
  }
  async function portal(){
    setBusy("portal");setError("");
    const r=await fetch("/api/billing/portal",{method:"POST"});
    const b=await r.json();setBusy("");
    if(b.url)window.location.assign(b.url);else setError(b.error);
  }

  if(paidSubscription)return <div className="billing-current">
    <div className="billing-usage">
      <span>Active strategies</span>
      <strong>{activeStrategyCount}{currentMaxActiveStrategies==null?"":" / "+currentMaxActiveStrategies}</strong>
    </div>
    <p>You’re on <strong>{currentPlanSlug}</strong>. Change plan, billing cycle or payment details in one place.</p>
    <div className="billing-impact-note">
      <strong>Changing to a smaller plan is safe.</strong>
      <span>If the new plan allows fewer active strategies — or removes a feature an active strategy depends on, such as multiple linked accounts — affected strategies are paused automatically. Their history is preserved and can be resumed later when your plan allows it.</span>
    </div>
    <button className="button primary" disabled={Boolean(busy)} onClick={portal}>{busy==="portal"?"Opening…":"Manage billing"}</button>
    {error&&<div className="error" role="alert">{error}</div>}
  </div>;

  const slugs=[...new Set(prices.map((price)=>price.planSlug))];
  return <div className="stack billing-options">
    {currencies.length>1&&<Field className="field compact-field" label="Billing currency"><select value={currency} onChange={e=>setCurrency(e.target.value)}>{currencies.map(c=><option key={c}>{c}</option>)}</select></Field>}
    <div className="billing-plan-grid">
      {slugs.map((slug)=>{
        const plan=planSummary(prices,slug,currency);
        if(!plan.meta)return null;
        const limit=plan.meta.maxActiveStrategies==null?"Unlimited active strategies":"Up to "+plan.meta.maxActiveStrategies+" active "+(plan.meta.maxActiveStrategies===1?"strategy":"strategies");
        const raw=plan.meta.entitlements&&typeof plan.meta.entitlements==="object"?plan.meta.entitlements:{};
        const channels=Array.isArray(raw.notificationChannels)?raw.notificationChannels.filter((value):value is string=>typeof value==="string"):[];
        return <div className={"billing-plan "+(slug==="pro"?"featured":"")} key={slug}>
          <div><span className="billing-plan-name">{plan.meta.planName}</span>{slug==="pro"&&<span className="pill good">MOST FLEXIBLE</span>}</div>
          <strong>{plan.monthly?new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(plan.monthly.amountMinor/100)+"/mo":"Paid plan"}</strong>
          <p>{limit}{channels.length?" · "+channels.map((channel)=>channel[0]+channel.slice(1).toLowerCase()).join(" + ")+" alerts":""}</p>
          <div className="billing-plan-actions">
            {plan.monthly&&<button className="button primary" disabled={Boolean(busy)} onClick={()=>checkout(slug,"monthly")}>{busy===slug+"monthly"?"Opening…":"Choose monthly"}</button>}
            {plan.annual&&<button className="button" disabled={Boolean(busy)} onClick={()=>checkout(slug,"annual")}>{busy===slug+"annual"?"Opening…":"Annual · "+new Intl.NumberFormat("en-GB",{style:"currency",currency,maximumFractionDigits:0}).format(plan.annual.amountMinor/100)}</button>}
          </div>
        </div>;
      })}
    </div>
    {currentPlanSlug==="free"&&<p className="help">Your Free plan keeps working if you do nothing. Upgrading only changes the limits and features available to your account. Nothing changes until checkout completes successfully.</p>}
    {error&&<div className="error">{error}</div>}
  </div>;
}

export function PrivacyControls({optIn}:{optIn:boolean}){const[state,setState]=useState(optIn);const[message,setMessage]=useState("");async function toggle(){const next=!state;const r=await fetch("/api/account/privacy",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({anonymousAggregateOptIn:next})});if(r.ok){setState(next);setMessage("Privacy preference updated.");}else setMessage("Could not update preference.");}async function remove(){if(!confirm("Permanently delete your account and financial history from the application?"))return;const r=await fetch("/api/account/delete",{method:"DELETE"});if(r.ok)await signOut({callbackUrl:"/"});else setMessage("Could not delete account.");}return <div className="stack"><div className="inline"><button className="button" onClick={toggle}>{state?"Opt out of anonymous aggregates":"Opt in to anonymous aggregates"}</button><a className="button" href="/api/account/export">Export my data</a></div><button className="button danger" onClick={remove}>Delete account</button>{message&&<div className={message.startsWith("Privacy")?"success":"error"}>{message}</div>}</div>;}


export function SecurityControls({enabled}:{enabled:boolean}){
  const[on,setOn]=useState(enabled);
  const[setup,setSetup]=useState<{secret:string;otpauthUri:string}|null>(null);
  const[recovery,setRecovery]=useState<string[]|null>(null);
  const[message,setMessage]=useState("");
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  async function call(path:string,body?:unknown){
    setBusy(true);setError("");setMessage("");
    try{
      const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:body?JSON.stringify(body):undefined});
      const b=await r.json().catch(()=>({} as {error?:string}));
      if(!r.ok){setError(b.error??"Something went wrong. Please try again.");return null;}
      return b;
    }catch{setError("Could not reach the server. Please try again.");return null;}
    finally{setBusy(false);}
  }
  if(on&&!recovery)return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=await call("/api/account/mfa/disable",{password:f.get("password"),code:f.get("code")});if(b){setOn(false);setSetup(null);setMessage("Two-step sign-in is off.");}}}>
    <p className="help">Two-step sign-in is on. To turn it off, confirm your password and a current code (or a recovery code).</p>
    <div className="form-grid"><div className="field"><label htmlFor="mfa-off-password">Password</label><input id="mfa-off-password" name="password" type="password" autoComplete="current-password" required/></div>
    <div className="field"><label htmlFor="mfa-off-code">Code</label><input id="mfa-off-code" name="code" autoComplete="one-time-code" required/></div></div>
    <button className="button danger" disabled={busy}>Turn off two-step sign-in</button>
    {error&&<div className="error">{error}</div>}{message&&<div className="success">{message}</div>}
  </form>;
  if(recovery)return <div className="stack">
    <div className="success">Two-step sign-in is on.</div>
    <p className="help">Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again.</p>
    <pre style={{fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{recovery.join("\n")}</pre>
    <button className="button primary" onClick={()=>{setRecovery(null);setSetup(null);}}>I have saved them</button>
  </div>;
  if(setup)return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=await call("/api/account/mfa/enable",{code:f.get("code")});if(b){setOn(true);setRecovery(b.recoveryCodes);}}}>
    <p className="help">Add this account to your authenticator app by entering the key below (or opening the link on a device that has the app), then type the 6-digit code it shows.</p>
    <div className="field"><label htmlFor="mfa-secret">Key</label><input id="mfa-secret" readOnly value={setup.secret} onFocus={(e)=>e.currentTarget.select()}/></div>
    <a className="button" href={setup.otpauthUri}>Open in authenticator app</a>
    <div className="field"><label htmlFor="mfa-code">Code from the app</label><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required/></div>
    <button className="button primary" disabled={busy}>Confirm and turn on</button>
    {error&&<div className="error">{error}</div>}
  </form>;
  return <div className="stack">
    <p className="help">Ask for a code from an authenticator app when you sign in, on top of your password.</p>
    <button className="button" disabled={busy} onClick={async()=>{const b=await call("/api/account/mfa/setup");if(b)setSetup(b);}}>Set up two-step sign-in</button>
    {error&&<div className="error">{error}</div>}{message&&<div className="success">{message}</div>}
  </div>;
}

/** A one-time deep link verifies the user controls the private Telegram chat. */
export function TelegramForm({connected,allowed}:{connected:boolean;allowed:boolean}){
  const[linked,setLinked]=useState(connected);
  const[url,setUrl]=useState("");
  const[message,setMessage]=useState("");
  const[busy,setBusy]=useState(false);
  async function connect(){setBusy(true);setMessage("");setUrl("");try{
    const r=await fetch("/api/settings/telegram",{method:"POST"});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||"Could not start Telegram connection.");
    setUrl(String(data.url));setMessage("Open the link and press Start in the Telegram bot, then refresh this page.");
  }catch(e){setMessage(e instanceof Error?e.message:"Telegram connection failed.");}finally{setBusy(false);}}
  async function disconnect(){setBusy(true);setMessage("");try{
    const r=await fetch("/api/settings/telegram",{method:"DELETE"});
    if(!r.ok)throw new Error("Could not disconnect Telegram.");
    setLinked(false);setUrl("");setMessage("Telegram disconnected.");
  }catch(e){setMessage(e instanceof Error?e.message:"Could not disconnect.");}finally{setBusy(false);}}
  return <div className="stack">
    <p className="help">{!allowed?"Telegram alerts are not included in your current plan.":linked?"Telegram is connected. Your plan controls whether alerts are delivered.":"Telegram is not connected."}</p>
    <div className="inline">{linked?<button className="button" type="button" disabled={busy} onClick={disconnect}>Disconnect Telegram</button>:<button className="button" type="button" disabled={busy||!allowed} onClick={connect}>Connect Telegram</button>}
      {url&&<a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Open Telegram bot</a>}</div>
    {message&&<p className="help" role="status">{message}</p>}
  </div>;
}
