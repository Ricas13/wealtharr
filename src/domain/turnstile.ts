/** Optional Cloudflare Turnstile security boundary for public authentication forms.
 * The widget alone is never proof: every submission validates the single-use token at Siteverify.
 * Set TURNSTILE_ENABLED=true only after BOTH widget and secret credentials are deployed.
 */
export type TurnstileAction="register"|"login"|"reset";
export type TurnstileEnvironment={
  TURNSTILE_ENABLED?:string;TURNSTILE_SITE_KEY?:string;TURNSTILE_SECRET_KEY?:string;
  NEXT_PUBLIC_APP_URL?:string;
};
export const TURNSTILE_SITEVERIFY="https://challenges.cloudflare.com/turnstile/v0/siteverify";
export class TurnstileError extends Error {
  constructor(readonly code:"TURNSTILE_CONFIGURATION_ERROR"|"TURNSTILE_REQUIRED"|"TURNSTILE_REJECTED"|"TURNSTILE_UNAVAILABLE"){
    super(code);this.name="TurnstileError";
  }
}
export function turnstileEnabled(env:TurnstileEnvironment):boolean{
  return env.TURNSTILE_ENABLED==="true";
}
export async function requireTurnstile(args:{
  action:TurnstileAction;token:unknown;env:TurnstileEnvironment;fetcher?:typeof fetch;
}):Promise<void>{
  const {action,token,env}=args;
  if(!turnstileEnabled(env))return;
  const secret=env.TURNSTILE_SECRET_KEY,siteKey=env.TURNSTILE_SITE_KEY;
  let expectedHostname:string;
  try{
    if(!secret||!siteKey||!env.NEXT_PUBLIC_APP_URL)throw new Error("config");
    const origin=new URL(env.NEXT_PUBLIC_APP_URL);
    if(!["https:","http:"].includes(origin.protocol)||!origin.hostname)throw new Error("origin");
    expectedHostname=origin.hostname.toLowerCase();
  }catch{throw new TurnstileError("TURNSTILE_CONFIGURATION_ERROR");}
  if(typeof token!=="string"||token.length<1||token.length>2048)throw new TurnstileError("TURNSTILE_REQUIRED");
  const body=new URLSearchParams({secret:secret!,response:token});
  let data:unknown;
  try{
    const response=await (args.fetcher??fetch)(TURNSTILE_SITEVERIFY,{
      method:"POST",
      headers:{"content-type":"application/x-www-form-urlencoded"},
      body,
      cache:"no-store",
      redirect:"error",
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw new Error("siteverify unavailable");
    data=await response.json();
  }catch{throw new TurnstileError("TURNSTILE_UNAVAILABLE");}
  if(!data||typeof data!=="object"||Array.isArray(data))throw new TurnstileError("TURNSTILE_REJECTED");
  const result=data as Record<string,unknown>;
  // A valid token from another site or flow is not valid for this action.
  if(result.success!==true||typeof result.hostname!=="string"||
      result.hostname.toLowerCase()!==expectedHostname||result.action!==action)
    throw new TurnstileError("TURNSTILE_REJECTED");
}
