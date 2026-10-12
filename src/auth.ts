import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { sql } from "@/lib/db";
import { consumeRateLimit } from "@/lib/security";
import { verifySecondFactor } from "@/lib/mfa";
import Google from "next-auth/providers/google";
import Apple from "next-auth/providers/apple";
import { resolveOAuthSignIn } from "@/lib/oauth";
import { notifySecurityEvent } from "@/lib/security-notice";
import { appleConfigured, profileEmailVerified } from "@/domain/oauth-providers";
import { getAppleClientSecret } from "@/lib/apple-client-secret";
import { ensureSettings } from "@/lib/settings";
import { recordSignIn } from "@/lib/sign-in-devices";
import { headers as requestHeaders } from "next/headers";

const credentials = z.object({ email: z.string().email(), password: z.string().min(8).max(128), totp: z.string().max(32).optional() });

// Provider credentials come from the admin screen (or the environment), so the provider list is
// built per request rather than once at start-up: changing them takes effect without a restart.
async function oauthProviders() {
  const env = process.env;
  const providers = [];
  if (env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET) {
    providers.push(Google({ clientId: env.AUTH_GOOGLE_ID, clientSecret: env.AUTH_GOOGLE_SECRET }));
  }
  if (appleConfigured(env)) {
    try {
      providers.push(Apple({
        clientId: env.AUTH_APPLE_ID,
        clientSecret: env.AUTH_APPLE_SECRET ?? (await getAppleClientSecret({
          teamId: env.AUTH_APPLE_TEAM_ID!, clientId: env.AUTH_APPLE_ID!, keyId: env.AUTH_APPLE_KEY_ID!, privateKey: env.AUTH_APPLE_PRIVATE_KEY!
        }))
      }));
    } catch {
      // An unreadable Apple key must not take password sign-in down with it.
    }
  }
  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth(async () => {
  await ensureSettings();
  return {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    ...(await oauthProviders()),
    Credentials({
      credentials: { email: {}, password: {}, totp: {} },
      async authorize(raw, request) {
        const parsed = credentials.safeParse(raw);
        if (!parsed.success) return null;
        try {
          await consumeRateLimit("login:" + parsed.data.email.toLowerCase(), 12, 15 * 60);
        } catch {
          return null;
        }
        const rows = await sql.unsafe(
          "SELECT id,email,password_hash,email_verified_at,role,session_version,mfa_enabled_at FROM users WHERE lower(email)=lower($1) AND deleted_at IS NULL LIMIT 1",
          [parsed.data.email]
        );
        const user = rows[0];
        if (!user) return null;
        if (process.env.NODE_ENV === "production" && !user.email_verified_at) return null;
        // Accounts created through a provider have no password until they set one by reset.
        if (!user.password_hash || !await bcrypt.compare(parsed.data.password, String(user.password_hash))) return null;
        // Two-step sign-in, when the account has it on. The shared per-email attempt limit above
        // also bounds guesses at the six-digit code.
        if (user.mfa_enabled_at && !(await verifySecondFactor(String(user.id), parsed.data.totp))) return null;
        await recordSignIn(String(user.id), request?.headers?.get("user-agent"));
        return { id: String(user.id), email: String(user.email), role: String(user.role), sessionVersion: Number(user.session_version ?? 0),
          // Reaching this line means the second factor was verified whenever the account has one.
          mfa: Boolean(user.mfa_enabled_at)
        };
      }
    })
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.type === "credentials") return true;
      // Provider sign-ins are mapped onto application users here (see resolveOAuthSignIn for the
      // rules). The resolved user replaces the provider's, so the session carries our id and role.
      try {
        const result = await resolveOAuthSignIn({
          provider: account.provider,
          providerAccountId: account.providerAccountId,
          email: user.email ?? (typeof profile?.email === "string" ? profile.email : null),
          emailVerified: profileEmailVerified(account.provider, profile as Record<string, unknown> | undefined)
        });
        if (!result.ok) return "/login?error=" + encodeURIComponent("oauth_" + result.reason);
        user.id = result.user.id;
        user.email = result.user.email;
        user.role = result.user.role;
        user.sessionVersion = result.user.sessionVersion;
        let userAgent: string | null = null;
        try { userAgent = (await requestHeaders()).get("user-agent"); } catch { /* no request context */ }
        await recordSignIn(result.user.id, userAgent);
        if (result.newlyLinked) await notifySecurityEvent(result.user.id, "SIGN_IN_METHOD_ADDED", account.provider);
        return true;
      } catch {
        return "/login?error=oauth_FAILED";
      }
    },
    jwt({ token, user }) {
      if (user?.id) token.uid = user.id;
      if (user && "role" in user) token.role = String(user.role);
      if (user) token.sv = Number(user.sessionVersion ?? 0);
      // Set only at sign-in (the user object exists only then) and carried unchanged afterwards:
      // whether a second factor was verified, and when the person last proved who they are.
      if (user) { token.mfa = user.mfa === true; token.at = Date.now(); }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? token.sub ?? "");
        session.user.role = String(token.role ?? "USER");
        // Tokens issued before session versions existed carry none and count as version 0.
        session.user.sessionVersion = Number(token.sv ?? 0);
        session.user.mfa = token.mfa === true;
        session.user.authTime = Number(token.at ?? 0);
      }
      return session;
    }
  }
};
});
