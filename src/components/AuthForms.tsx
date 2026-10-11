"use client";
import { Field } from "@/components/Field";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export function LoginForm({next="/app"}:{next?:string}) {
  const router=useRouter(); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);
    const result=await signIn("credentials",{email:String(f.get("email")),password:String(f.get("password")),totp:String(f.get("totp")??""),redirect:false});
    setBusy(false); if(result?.error) setError("Email, password or authentication code is incorrect, or the email is not verified."); else router.push(next);
  }}>
    <div className="field"><label htmlFor="login-email">Email</label><input id="login-email" name="email" type="email" autoComplete="email" required/></div>
    <div className="field"><label htmlFor="login-password">Password</label><input id="login-password" name="password" type="password" autoComplete="current-password" required/></div>
    <div className="field"><label htmlFor="login-totp">Authentication code</label><input id="login-totp" name="totp" inputMode="text" autoComplete="one-time-code" maxLength={16}/><div className="help">Only if you turned on two-step sign-in. A recovery code also works.</div></div>
    {error&&<div className="error">{error}</div>}<button className="button primary" disabled={busy}>Sign in</button>
  </form>;
}

export function RegisterForm({next="/app"}:{next?:string}) {
  const router=useRouter(); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);
    const response=await fetch("/api/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:f.get("email"),password:f.get("password"),country:f.get("country"),baseCurrency:f.get("currency")})});
    const body=await response.json();setBusy(false); if(!response.ok) return setError(body.error ?? "Could not register.");
    if(body.verificationDelivery==="unavailable") return setError("Account created, but email delivery is not configured. An administrator must configure the email provider.");
    if(process.env.NODE_ENV!=="production") { await signIn("credentials",{email:String(f.get("email")),password:String(f.get("password")),redirect:false}); router.push(next); }
    else router.push("/login?registered=1&next="+encodeURIComponent(next));
  }}>
    <div className="field"><label htmlFor="register-email">Email</label><input id="register-email" name="email" type="email" autoComplete="email" required/></div>
    <div className="field"><label htmlFor="register-password">Password</label><input id="register-password" name="password" type="password" autoComplete="new-password" minLength={12} required/><div className="help">At least 12 characters.</div></div>
    <div className="form-grid"><div className="field"><label htmlFor="register-country">Country</label><select id="register-country" name="country" defaultValue="GB"><option value="GB">United Kingdom</option><option value="US">United States</option><option value="IE">Ireland</option><option value="PT">Portugal</option></select></div>
    <div className="field"><label htmlFor="register-currency">Base currency</label><select id="register-currency" name="currency" defaultValue="GBP"><option>GBP</option><option>USD</option><option>EUR</option></select></div></div>
    {error&&<div className="error">{error}</div>}<button className="button primary" disabled={busy}>Create account</button>
  </form>;
}

export function VerifyForm({token}:{token:string}) {
  const [message,setMessage]=useState(""); const [busy,setBusy]=useState(false);
  return <div className="stack"><button className="button primary" disabled={busy||!token} onClick={async()=>{setBusy(true);try{const r=await fetch("/api/verify-email",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token})});const b=await r.json().catch(()=>({} as {error?:string}));setMessage(r.ok?"Email verified. You can sign in now.":(b.error??"Could not verify your email. Please try again."));}catch{setMessage("Could not reach the server. Please try again.");}finally{setBusy(false);}}}>Verify email</button>{message&&<div className={message.startsWith("Email verified")?"success":"error"}>{message}</div>}</div>;
}

export function ResetPasswordForm({token}:{token?:string}) {
  const [message,setMessage]=useState("");
  if(!token) return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{await fetch("/api/password-reset/request",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:f.get("email")})});setMessage("If that account exists, a reset link has been sent.");}catch{setMessage("Could not reach the server. Please check your connection and try again.");}}}><Field label="Email"><input name="email" type="email" required/></Field><button className="button primary">Send reset link</button>{message&&<div className="success">{message}</div>}</form>;
  return <form className="stack" onSubmit={async(e)=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const r=await fetch("/api/password-reset/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,password:f.get("password")})});const b=await r.json().catch(()=>({} as {error?:string}));setMessage(r.ok?"Password updated. You can sign in.":(b.error??"Could not update your password. Please try again."));}catch{setMessage("Could not reach the server. Please try again.");}}}><Field label="New password"><input name="password" type="password" minLength={12} required/></Field><button className="button primary">Update password</button>{message&&<div className={message.startsWith("Password updated")?"success":"error"}>{message}</div>}</form>;
}


const OAUTH_ERRORS:Record<string,string>={
  oauth_EMAIL_NOT_VERIFIED:"That provider did not confirm your email address, so we could not sign you in with it. Use your email and password instead.",
  oauth_ACCOUNT_UNAVAILABLE:"This account is not available.",
  oauth_USE_PASSWORD_SIGN_IN:"This account has extra protection turned on. Sign in with your email, password and authentication code.",
  oauth_INVALID_IDENTITY:"The provider did not return enough information to sign you in.",
  oauth_FAILED:"We could not complete sign-in with that provider. Please try again or use your email and password."
};

export function OAuthButtons({providers,next="/app",error}:{providers:Array<{id:string;label:string}>;next?:string;error?:string}){
  const[busy,setBusy]=useState("");
  const message=error?(OAUTH_ERRORS[error]??(error.startsWith("oauth_")||error==="AccessDenied"||error==="OAuthCallbackError"?OAUTH_ERRORS.oauth_FAILED:"")):"";
  if(!providers.length&&!message)return null;
  return <div className="stack" aria-label="Continue with">
    {message&&<div className="error" role="alert">{message}</div>}
    {providers.map((p)=><button key={p.id} type="button" className="button" disabled={Boolean(busy)} onClick={async()=>{setBusy(p.id);await signIn(p.id,{callbackUrl:next});}}>Continue with {p.label}</button>)}
    {providers.length>0&&<div className="help" style={{textAlign:"center"}}>or use your email</div>}
  </div>;
}
