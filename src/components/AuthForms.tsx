"use client";
import { Field } from "@/components/Field";
import { InlineMessage, MessageView, useMessage } from "@/components/InlineMessage";
import { postJson } from "@/lib/http";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

export function LoginForm({next="/app"}:{next?:string}) {
  const router=useRouter(); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);setError("");const f=new FormData(e.currentTarget);
    try{
      const result=await signIn("credentials",{email:String(f.get("email")),password:String(f.get("password")),totp:String(f.get("totp")??""),redirect:false});
      if(result?.error)setError("Email, password or authentication code is incorrect, or the email is not verified.");
      else router.push(next);
    }catch{
      setError("Could not reach the server. Check your connection and try again.");
    }finally{
      setBusy(false);
    }
  }}>
    <Field label="Email"><input id="login-email" name="email" type="email" autoComplete="email" required/></Field>
    <Field label="Password"><input id="login-password" name="password" type="password" autoComplete="current-password" required/></Field>
    <Field label="Authentication code" help="Only if you turned on two-step sign-in. A recovery code also works."><input id="login-totp" name="totp" inputMode="text" autoComplete="one-time-code" maxLength={16}/></Field>
    {error&&<InlineMessage tone="error">{error}</InlineMessage>}<button className="button primary" disabled={busy}>Sign in</button>
  </form>;
}

export function RegisterForm() {
  const router=useRouter(); const status=useMessage(); const [busy,setBusy]=useState(false);
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);status.clear();const f=new FormData(e.currentTarget);
    try{
      const result=await postJson("/api/register",{email:f.get("email"),password:f.get("password"),country:f.get("country"),baseCurrency:f.get("currency")},{fallbackError:"Could not register."});
      if(!result.ok){status.error(result.errorText);return;}
      if(result.data.verificationDelivery==="unavailable"){status.warning("Account created, but email delivery is not configured. An administrator must configure the email provider.");return;}
      if(process.env.NODE_ENV!=="production") { await signIn("credentials",{email:String(f.get("email")),password:String(f.get("password")),redirect:false}); router.push("/app"); }
      else router.push("/login?registered=1");
    }catch{
      status.error("Could not complete sign-in. Please try again.");
    }finally{
      setBusy(false);
    }
  }}>
    <Field label="Email"><input id="register-email" name="email" type="email" autoComplete="email" required/></Field>
    <Field label="Password" help="At least 12 characters."><input id="register-password" name="password" type="password" autoComplete="new-password" minLength={12} required/></Field>
    <div className="form-grid"><Field label="Country"><select id="register-country" name="country" defaultValue="GB"><option value="GB">United Kingdom</option><option value="US">United States</option><option value="IE">Ireland</option><option value="PT">Portugal</option></select></Field>
    <Field label="Base currency"><select id="register-currency" name="currency" defaultValue="GBP"><option>GBP</option><option>USD</option><option>EUR</option></select></Field></div>
    <MessageView message={status.message}/><button className="button primary" disabled={busy}>Create account</button>
  </form>;
}

export function VerifyForm({token}:{token:string}) {
  const status=useMessage(); const [busy,setBusy]=useState(false);
  return <div className="stack"><button className="button primary" disabled={busy||!token} onClick={async()=>{
    setBusy(true);status.clear();
    try{
      const result=await postJson("/api/verify-email",{token},{fallbackError:"Could not verify your email. Please try again."});
      if(result.ok)status.success("Email verified. You can sign in now.");
      else status.error(result.errorText);
    }finally{
      setBusy(false);
    }
  }}>Verify email</button><MessageView message={status.message}/></div>;
}

export function ResetPasswordForm({token}:{token?:string}) {
  const status=useMessage(); const [busy,setBusy]=useState(false);
  if(!token) return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);status.clear();const f=new FormData(e.currentTarget);
    try{
      const result=await postJson("/api/password-reset/request",{email:f.get("email")},{fallbackError:"Could not send the reset link. Please try again."});
      // The server answers the same way whether or not the account exists, so success never reveals which.
      if(result.ok)status.success("If that account exists, a reset link has been sent.");
      else status.error(result.errorText);
    }finally{
      setBusy(false);
    }
  }}><Field label="Email"><input name="email" type="email" autoComplete="email" required/></Field><button className="button primary" disabled={busy}>Send reset link</button><MessageView message={status.message}/></form>;
  return <form className="stack" onSubmit={async(e)=>{
    e.preventDefault();setBusy(true);status.clear();const f=new FormData(e.currentTarget);
    try{
      const result=await postJson("/api/password-reset/confirm",{token,password:f.get("password")},{fallbackError:"Could not update your password. Please try again."});
      if(result.ok)status.success("Password updated. You can sign in.");
      else status.error(result.errorText);
    }finally{
      setBusy(false);
    }
  }}><Field label="New password" help="At least 12 characters."><input name="password" type="password" autoComplete="new-password" minLength={12} required/></Field><button className="button primary" disabled={busy}>Update password</button><MessageView message={status.message}/></form>;
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
  return <div className="stack" role="group" aria-label="Continue with">
    {message&&<InlineMessage tone="error">{message}</InlineMessage>}
    {providers.map((p)=><button key={p.id} type="button" className="button" disabled={Boolean(busy)} onClick={async()=>{setBusy(p.id);try{await signIn(p.id,{callbackUrl:next});}catch{setBusy("");}}}>Continue with {p.label}</button>)}
    {providers.length>0&&<div className="help" style={{textAlign:"center"}}>or use your email</div>}
  </div>;
}
