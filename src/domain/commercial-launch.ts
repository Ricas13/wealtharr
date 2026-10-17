/** Pure production launch checks, intentionally separate from application liveness. */
type Environment=Record<string,string|undefined>;
/** Shown whenever MARKET_DATA_PROVIDER=yahoo; the market_data_mode launch gate can never pass for it. */
export const YAHOO_LAUNCH_WARNING="Market data provider is Yahoo (unofficial, not licensed for commercial redistribution) - replace before charging customers";
/** Non-gating provider warnings for the launch page; empty when nothing needs flagging. */
export function marketDataProviderWarnings(env:Environment):string[]{
 return env.MARKET_DATA_PROVIDER==="yahoo"?[YAHOO_LAUNCH_WARNING]:[];
}
export type LaunchCheck={key:string;passed:boolean;reason:string};
const validHttps=(s:string|undefined)=>{try{
 if(!s)return false;
 const url=new URL(s);
 return url.protocol==="https:" && !!url.hostname && !url.username && !url.password &&
  !url.hash && !["localhost","127.0.0.1","[::1]"].includes(url.hostname.toLowerCase());
 }catch{return false;}};
const enough=(s:string|undefined,length:number)=>!!s&&s.length>=length&&!/^(replace|changeme|example|ci-only|test-)/i.test(s);
const validKey=(s:string|undefined)=>{if(!s||!/^[A-Za-z0-9+/]{43}=$/.test(s))return false;
  return Buffer.from(s,"base64").length===32;};
export function checkCommercialLaunch(env:Environment):LaunchCheck[]{
 const stripe=env.STRIPE_SECRET_KEY, webhook=env.STRIPE_WEBHOOK_SECRET;
 return [
 {key:"application_url",passed:validHttps(env.NEXT_PUBLIC_APP_URL),reason:"Public origin must use HTTPS."},
 {key:"database",passed:!!env.DATABASE_URL&&/^postgres(ql)?:\/\//.test(env.DATABASE_URL)&&(/@(db|postgres|postgresql):5432\//.test(env.DATABASE_URL)||!/(localhost|127\.0\.0\.1)/.test(env.DATABASE_URL)),reason:"Configure a persistent protected PostgreSQL service (Docker network or external host)."},
 {key:"auth_secret",passed:enough(env.AUTH_SECRET,32),reason:"Supply a unique secure authentication secret."},
 {key:"encryption",passed:validKey(env.APP_ENCRYPTION_KEY),reason:"Supply a properly generated 32-byte encryption key."},
 {key:"worker_auth",passed:enough(env.CRON_SECRET,32),reason:"Supply a unique worker bearer token."},
 {key:"stripe_live",passed:!!stripe&&/^(sk|rk)_live_/.test(stripe)&&stripe.length>=20,reason:"A Stripe LIVE secret or restricted (rk_live_) key is required for paid launch."},
 {key:"stripe_webhook",passed:!!webhook&&webhook.startsWith("whsec_")&&webhook.length>=20,reason:"Stripe webhook signing secret is required."},
 {key:"email",passed:env.EMAIL_PROVIDER==="http"&&validHttps(env.EMAIL_HTTP_ENDPOINT)&&enough(env.EMAIL_HTTP_TOKEN,12)&&!!env.EMAIL_FROM&&!env.EMAIL_FROM.endsWith("@example.com"),reason:"Configure live transactional email with HTTPS credentials."},
 {key:"market_data_mode",passed:env.MARKET_DATA_PROVIDER==="http"&&validHttps(env.MARKET_DATA_HTTP_BASE_URL)&&enough(env.MARKET_DATA_HTTP_TOKEN,12),reason:env.MARKET_DATA_PROVIDER==="yahoo"?YAHOO_LAUNCH_WARNING:"Configure an authenticated historical/intraday and current-price service that permits your commercial use."},
 {key:"turnstile",passed:env.TURNSTILE_ENABLED==="true"&&!!env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SITE_KEY.length>=20&&
    !!env.TURNSTILE_SECRET_KEY&&env.TURNSTILE_SECRET_KEY.length>=20&&
    !/^[123]x0000000000000000000/.test(env.TURNSTILE_SITE_KEY)&&
    !/^[123]x0000000000000000000/.test(env.TURNSTILE_SECRET_KEY),
    reason:"Enable Cloudflare Turnstile and configure real site and server-secret keys for the live hostname (no test credentials)."},
 {key:"admin_mfa",passed:env.ADMIN_MFA_REQUIRED==="true",reason:"Require two-step sign-in for administrators (ADMIN_MFA_REQUIRED=true) once every admin has enrolled."},
 {key:"backup_operator_attestation",passed:env.BACKUPS_RESTORE_VERIFIED==="true",reason:"Operator must verify a successful backup restore."},
 {key:"regulatory_signoff",passed:env.UK_REGULATORY_SIGNOFF_VERIFIED==="true",reason:"Obtain documented UK legal/regulatory review before charging customers."},
 {key:"instrument_review",passed:env.REGIONAL_INSTRUMENTS_VERIFIED==="true",reason:"Operator must approve eligible regional trading lines."}
 ];
}

/**
 * Checks that must hold before a checkout session may be created. Stripe test-mode keys are
 * allowed through so staging acceptance can exercise the real flow; a LIVE key moves real money,
 * so every launch check must pass first, whatever the paid-launch flag says.
 */
export function paidCheckoutBlockers(env:Environment):LaunchCheck[]{
 const key=env.STRIPE_SECRET_KEY;
 if(!key||!/^(sk|rk)_live_/.test(key))return [];
 return checkCommercialLaunch(env).filter((check)=>!check.passed);
}
