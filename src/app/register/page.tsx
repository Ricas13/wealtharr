import Link from "next/link";
import { RegisterForm,OAuthButtons } from "@/components/AuthForms";
import { enabledOAuthProviders } from "@/domain/oauth-providers";
import { providersForClient } from "@/domain/native-app";
import { headers } from "next/headers";
export const dynamic="force-dynamic";

export default async function RegisterPage({searchParams}:{searchParams:Promise<{plan?:string}>}){
 const params=await searchParams;
 const slug=typeof params.plan==="string"&&/^[a-z][a-z0-9-]{0,59}$/.test(params.plan)?params.plan:"";
 // Keep only a path in the signed-in area; selection never creates a charge.
 const next=slug&&slug!=="free"?"/app/settings?plan="+encodeURIComponent(slug):"/app";
 const ua=(await headers()).get("user-agent");
 return <main className="auth-page"><section className="glass auth-card">
  <Link href="/" className="brand"><span className="brand-mark"/>{process.env.NEXT_PUBLIC_BRAND_NAME?.trim()||"Wealtharr"}</Link>
  <h1>Start simple.</h1><p>Country and base currency are enough to create the account. Strategy-specific details come later, only when needed.</p>
  {slug&&slug!=="free"&&<p className="help">After sign-in, review the plan you selected and its available billing options. Registration does not charge you.</p>}
  <OAuthButtons providers={providersForClient(enabledOAuthProviders(process.env),ua)} next={next}/>
  <RegisterForm next={next}/>
  <p className="help">By continuing you acknowledge that this product calculates rules for strategies you select yourself; it does not assess suitability.</p>
 </section></main>;
}
