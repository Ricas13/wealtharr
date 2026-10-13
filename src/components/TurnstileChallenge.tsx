"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";
import type { TurnstileAction } from "@/domain/turnstile";

type TurnstileApi={
  render:(node:HTMLElement,options:{
    sitekey:string;action:TurnstileAction;theme:"auto";
    callback:(token:string)=>void;"expired-callback":()=>void;"error-callback":()=>void;
  })=>string;
  remove:(widgetId:string)=>void;
};
declare global {interface Window { turnstile?: TurnstileApi; }}
/** Explicit render: React controls the widget lifecycle, not Cloudflare's DOM scanner.
 * This component sends tokens back to the parent; it never treats a widget callback as
 * verification, which must happen on the server for each submitted request.
 */
export function TurnstileChallenge({enabled,siteKey,action,resetCounter=0,onTokenChange}:{
  enabled:boolean;siteKey:string;action:TurnstileAction;resetCounter?:number;
  onTokenChange:(token:string)=>void;
}){
  const container=useRef<HTMLDivElement>(null);
  const callbackRef=useRef(onTokenChange);
  useEffect(()=>{callbackRef.current=onTokenChange;},[onTokenChange]);
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    if(!enabled||!siteKey||!loaded||!container.current||!window.turnstile)return;
    const api=window.turnstile;
    const id=api.render(container.current,{
      sitekey:siteKey,action,theme:"auto",
      callback:token=>callbackRef.current(token),
      "expired-callback":()=>callbackRef.current(""),
      "error-callback":()=>callbackRef.current("")
    });
    return ()=>{api.remove(id);};
  },[enabled,siteKey,action,loaded,resetCounter]);
  if(!enabled)return null;
  if(!siteKey)return <p role="alert" className="help">Verification is temporarily unavailable. Please contact support.</p>;
  return <div className="stack" aria-label="Security verification">
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setLoaded(true)}/>
    <div ref={container}/>
    <p className="help">Protected by Cloudflare Turnstile. Complete the check before continuing.</p>
  </div>;
}
