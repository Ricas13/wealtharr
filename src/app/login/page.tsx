import Link from "next/link";
import { LoginForm,OAuthButtons } from "@/components/AuthForms";
import { ensureSettings } from "@/lib/settings";
import { enabledOAuthProviders } from "@/domain/oauth-providers";
import { providersForClient } from "@/domain/native-app";
import { headers } from "next/headers";
import { safeNextPath } from "@/domain/safe-next";
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}){await ensureSettings();const params=await searchParams;const ua=(await headers()).get("user-agent");return <main className="auth-page"><section className="glass auth-card"><Link href="/" className="brand"><span className="brand-mark"/>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><h1>Welcome back.</h1><p>Open your strategy workspace and see what needs attention.</p><OAuthButtons providers={providersForClient(enabledOAuthProviders(process.env),ua)} next={safeNextPath(params.next)} error={params.error}/><LoginForm next={safeNextPath(params.next)} turnstileEnabled={process.env.TURNSTILE_ENABLED==="true"} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY??""}/><div className="inline" style={{marginTop:18}}><Link href="/reset-password">Forgot password?</Link><span className="help">·</span><Link href="/register">Create account</Link></div></section></main>;}
