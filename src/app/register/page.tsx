import Link from "next/link";
import { RegisterForm,OAuthButtons } from "@/components/AuthForms";
import { enabledOAuthProviders } from "@/domain/oauth-providers";
import { providersForClient } from "@/domain/native-app";
import { headers } from "next/headers";
export const dynamic="force-dynamic";
export default async function RegisterPage(){const ua=(await headers()).get("user-agent");return <main className="auth-page"><section className="glass auth-card"><Link href="/" className="brand"><span className="brand-mark"/>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link><h1>Start simple.</h1><p>Country and base currency are enough to create the account. Strategy-specific details come later, only when needed.</p><OAuthButtons providers={providersForClient(enabledOAuthProviders(process.env),ua)}/><RegisterForm turnstileEnabled={process.env.TURNSTILE_ENABLED==="true"} turnstileSiteKey={process.env.TURNSTILE_SITE_KEY??""}/><p className="help">By continuing you acknowledge that this product calculates rules for strategies you select yourself; it does not assess suitability.</p></section></main>;}
