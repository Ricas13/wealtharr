"use client";
import { Field } from "@/components/Field";
import { InlineMessage, MessageView, useMessage } from "@/components/InlineMessage";
import { postJson, requestJson } from "@/lib/http";
import { useMemo, useState } from "react";
import { signOut } from "next-auth/react";

export function DiscordForm(){
  const status=useMessage();const[busy,setBusy]=useState(false);
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);status.clear();const f=new FormData(e.currentTarget);
    try{
      const result=await postJson("/api/settings/discord",{webhook:f.get("webhook")},{fallbackError:"Could not save the Discord webhook."});
      if(result.ok)status.success("Discord webhook saved.");else status.error(result.errorText);
    }finally{
      setBusy(false);
    }
  }}><Field label="Discord webhook"><input name="webhook" type="url" placeholder="https://discord.com/api/webhooks/..." required/></Field><button className="button" disabled={busy}>Save Discord webhook</button><MessageView message={status.message}/></form>;
}

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

  async function redirectTo(path:string,body:unknown,busyKey:string,fallbackError:string){
    setBusy(busyKey);setError("");
    try{
      const result=await postJson(path,body,{fallbackError});
      const url=result.ok?result.data.url:undefined;
      if(typeof url==="string"&&url)window.location.assign(url);
      else setError(result.errorText||fallbackError);
    }finally{
      setBusy("");
    }
  }
  function checkout(planSlug:string,cadence:"monthly"|"annual"){
    return redirectTo("/api/billing/checkout",{planSlug,cadence,currency},planSlug+cadence,"Could not open checkout. Please try again.");
  }
  function portal(){
    return redirectTo("/api/billing/portal",undefined,"portal","Could not open the billing portal. Please try again.");
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
    {error&&<InlineMessage tone="error">{error}</InlineMessage>}
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

export function PrivacyControls({optIn,hasPassword,mfaEnabled}:{optIn:boolean;hasPassword:boolean;mfaEnabled:boolean}){
  const[state,setState]=useState(optIn);
  const privacyStatus=useMessage();
  const[confirming,setConfirming]=useState(false);
  const[error,setError]=useState("");
  const[busy,setBusy]=useState(false);
  async function toggle(){
    const next=!state;
    privacyStatus.clear();
    const result=await requestJson("/api/account/privacy",{method:"PATCH",body:{anonymousAggregateOptIn:next},fallbackError:"Could not update preference."});
    if(result.ok){setState(next);privacyStatus.success("Privacy preference updated.");}
    else privacyStatus.error(result.errorText);
  }
  // Deleting is irreversible, so it asks again who is at the keyboard: the password, a current code
  // when two-step sign-in is on, or (for accounts that only use Google or Apple) the account email.
  async function remove(e:React.FormEvent<HTMLFormElement>){
    e.preventDefault();
    const f=new FormData(e.currentTarget);
    setBusy(true);setError("");
    try{
      const r=await fetch("/api/account/delete",{method:"DELETE",headers:{"content-type":"application/json"},body:JSON.stringify({password:f.get("password")||undefined,code:f.get("code")||undefined,confirmEmail:f.get("confirmEmail")||undefined})});
      const b=await r.json().catch(()=>({} as {error?:string}));
      if(r.ok||r.status===202){await signOut({callbackUrl:"/"});return;}
      setError(b.error??"Could not delete account.");
    }catch{setError("Could not reach the server. Please try again.");}
    finally{setBusy(false);}
  }
  return <div className="stack">
    <div className="inline"><button className="button" onClick={toggle}>{state?"Opt out of anonymous aggregates":"Opt in to anonymous aggregates"}</button><a className="button" href="/api/account/export">Export my data</a></div>
    {!confirming&&<button className="button danger" onClick={()=>{setConfirming(true);setError("");}}>Delete account</button>}
    {confirming&&<form className="stack" onSubmit={remove}>
      <p className="help">This permanently deletes your account and financial history from the application. It cannot be undone.{hasPassword?" Enter your password to confirm.":" You sign in with Google or Apple, so confirm by typing your account email. You must have signed in within the last 15 minutes; if not, sign out and sign in again first."}</p>
      {hasPassword&&<div className="field"><label htmlFor="delete-password">Password</label><input id="delete-password" name="password" type="password" autoComplete="current-password" required/></div>}
      {!hasPassword&&<div className="field"><label htmlFor="delete-email">Your account email</label><input id="delete-email" name="confirmEmail" type="email" autoComplete="email" required/></div>}
      {mfaEnabled&&<div className="field"><label htmlFor="delete-code">Authenticator or recovery code</label><input id="delete-code" name="code" autoComplete="one-time-code" required/></div>}
      <div className="inline"><button className="button danger" disabled={busy}>Permanently delete my account</button><button className="button" type="button" disabled={busy} onClick={()=>{setConfirming(false);setError("");}}>Cancel</button></div>
      {error&&<div className="error" role="alert">{error}</div>}
    </form>}
    <MessageView message={privacyStatus.message}/>
  </div>;
}



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
  // Changing two-step sign-in ends every session, this one included, so the next step is signing in again.
  const signInAgain=()=>signOut({callbackUrl:"/login"});
  if(on&&!recovery)return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=await call("/api/account/mfa/disable",{password:f.get("password"),code:f.get("code")});if(b){setOn(false);setSetup(null);setMessage("Two-step sign-in is off. Sign in again to continue.");await signInAgain();}}}>
    <p className="help">Two-step sign-in is on. To turn it off, confirm your password and a current code (or a recovery code). You will be signed out and asked to sign in again.</p>
    <div className="form-grid"><div className="field"><label htmlFor="mfa-off-password">Password</label><input id="mfa-off-password" name="password" type="password" autoComplete="current-password" required/></div>
    <div className="field"><label htmlFor="mfa-off-code">Code</label><input id="mfa-off-code" name="code" autoComplete="one-time-code" required/></div></div>
    <button className="button danger" disabled={busy}>Turn off two-step sign-in</button>
    {error&&<div className="error" role="alert">{error}</div>}{message&&<div className="success" role="status">{message}</div>}
  </form>;
  if(recovery)return <div className="stack">
    <div className="success" role="status">Two-step sign-in is on.</div>
    <p className="help">Save these recovery codes somewhere safe. Each works once if you lose your authenticator. They will not be shown again. When you continue you will be signed out; sign in again with your password and a code.</p>
    <pre style={{fontFamily:"monospace",whiteSpace:"pre-wrap"}}>{recovery.join("\n")}</pre>
    <button className="button primary" onClick={async()=>{setRecovery(null);setSetup(null);await signInAgain();}}>I have saved them</button>
  </div>;
  if(setup)return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=await call("/api/account/mfa/enable",{code:f.get("code"),password:f.get("password")});if(b){setOn(true);setRecovery(b.recoveryCodes);}}}>
    <p className="help">Add this account to your authenticator app by entering the key below (or opening the link on a device that has the app), then type the 6-digit code it shows.</p>
    <div className="field"><label htmlFor="mfa-secret">Key</label><input id="mfa-secret" readOnly value={setup.secret} onFocus={(e)=>e.currentTarget.select()}/></div>
    <a className="button" href={setup.otpauthUri}>Open in authenticator app</a>
    <div className="field"><label htmlFor="mfa-code">Code from the app</label><input id="mfa-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} required/></div>
    <div className="field"><label htmlFor="mfa-on-password">Password</label><input id="mfa-on-password" name="password" type="password" autoComplete="current-password" required/></div>
    <button className="button primary" disabled={busy}>Confirm and turn on</button>
    {error&&<div className="error" role="alert">{error}</div>}
  </form>;
  return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);const b=await call("/api/account/mfa/setup",{password:f.get("password")});if(b)setSetup(b);}}>
    <p className="help">Ask for a code from an authenticator app when you sign in, on top of your password. Enter your password to start.</p>
    <div className="field"><label htmlFor="mfa-start-password">Password</label><input id="mfa-start-password" name="password" type="password" autoComplete="current-password" required/></div>
    <button className="button" disabled={busy}>Set up two-step sign-in</button>
    {error&&<div className="error" role="alert">{error}</div>}{message&&<div className="success" role="status">{message}</div>}
  </form>;
}

/** A one-time deep link verifies the user controls the private Telegram chat. */
export function TelegramForm({connected,allowed}:{connected:boolean;allowed:boolean}){
  const[linked,setLinked]=useState(connected);
  const[url,setUrl]=useState("");
  const status=useMessage();
  const[busy,setBusy]=useState(false);
  async function connect(){setBusy(true);status.clear();setUrl("");try{
    const result=await postJson("/api/settings/telegram",undefined,{fallbackError:"Could not start Telegram connection."});
    if(!result.ok){status.error(result.errorText);return;}
    setUrl(String(result.data.url));status.info("Open the link and press Start in the Telegram bot, then refresh this page.");
  }finally{setBusy(false);}}
  async function disconnect(){setBusy(true);status.clear();try{
    const result=await requestJson("/api/settings/telegram",{method:"DELETE",fallbackError:"Could not disconnect Telegram."});
    if(!result.ok){status.error(result.errorText);return;}
    setLinked(false);setUrl("");status.success("Telegram disconnected.");
  }finally{setBusy(false);}}
  return <div className="stack">
    <p className="help">{!allowed?"Telegram alerts are not included in your current plan.":linked?"Telegram is connected. Your plan controls whether alerts are delivered.":"Telegram is not connected."}</p>
    <div className="inline">{linked?<button className="button" type="button" disabled={busy} onClick={disconnect}>Disconnect Telegram</button>:<button className="button" type="button" disabled={busy||!allowed} onClick={connect}>Connect Telegram</button>}
      {url&&<a className="button primary" href={url} target="_blank" rel="noopener noreferrer">Open Telegram bot</a>}</div>
    <MessageView message={status.message} as="p"/>
  </div>;
}

export function SignOutButton(){
  const[busy,setBusy]=useState(false);
  return <button className="button" type="button" disabled={busy} onClick={async()=>{setBusy(true);try{await signOut({callbackUrl:"/"});}catch{setBusy(false);}}}>Sign out</button>;
}
