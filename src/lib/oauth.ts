import "server-only";
import { sql } from "@/lib/db";
import { newAccountIsInvited } from "@/domain/beta-invites";

export type OAuthIdentity = {
  provider: string;
  providerAccountId: string;
  email: string | null | undefined;
  emailVerified: boolean;
};

export type OAuthResolution =
  | { ok: true; user: { id: string; email: string; role: string; sessionVersion: number }; created: boolean; newlyLinked?: boolean }
  | { ok: false; reason: "EMAIL_NOT_VERIFIED" | "ACCOUNT_UNAVAILABLE" | "USE_PASSWORD_SIGN_IN" | "INVALID_IDENTITY" | "INVITE_REQUIRED" };

type UserRow = Record<string, any>;

/**
 * Maps a provider identity to an application user. The rules exist to stop account takeover:
 *  - a returning provider identity is found by the provider's own subject id, not by email;
 *  - an existing account is linked by email only when the provider vouches the email is verified;
 *  - if that existing account was never email-verified, its password is cleared, because whoever
 *    pre-registered the address (and so knows that password) is not proven to own it;
 *  - administrators and accounts with two-step sign-in must use the password + code route, so a
 *    provider login can never be a way around their stronger protection;
 *  - deleted accounts are never revived.
 */
export async function resolveOAuthSignIn(identity: OAuthIdentity): Promise<OAuthResolution> {
  const provider = identity.provider.trim();
  const subject = identity.providerAccountId.trim();
  if (!provider || !subject) return { ok: false, reason: "INVALID_IDENTITY" };
  const email = identity.email?.trim().toLowerCase() || null;

  return sql.begin(async (tx) => {
    // Serialise concurrent first sign-ins for the same identity or address.
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtextextended($1,2))", [email ?? provider + ":" + subject]);

    const asUser = (row: UserRow) => ({ id: String(row.id), email: String(row.email), role: String(row.role), sessionVersion: Number(row.session_version ?? 0) });
    const eligible = (row: UserRow): OAuthResolution | null => {
      if (row.deleted_at) return { ok: false, reason: "ACCOUNT_UNAVAILABLE" };
      if (String(row.role) === "ADMIN" || row.mfa_enabled_at) return { ok: false, reason: "USE_PASSWORD_SIGN_IN" };
      return null;
    };

    const linked = await tx.unsafe(
      "SELECT u.id,u.email,u.role,u.session_version,u.deleted_at,u.mfa_enabled_at FROM oauth_accounts o JOIN users u ON u.id=o.user_id WHERE o.provider=$1 AND o.provider_account_id=$2",
      [provider, subject]
    );
    if (linked[0]) {
      return eligible(linked[0] as UserRow) ?? { ok: true, user: asUser(linked[0] as UserRow), created: false };
    }

    if (!email || !identity.emailVerified) return { ok: false, reason: "EMAIL_NOT_VERIFIED" };

    const existing = await tx.unsafe(
      "SELECT id,email,role,session_version,deleted_at,mfa_enabled_at,email_verified_at FROM users WHERE lower(email)=$1 FOR UPDATE",
      [email]
    );
    if (existing[0]) {
      const row = existing[0] as UserRow;
      const blocked = eligible(row);
      if (blocked) return blocked;
      if (!row.email_verified_at) {
        await tx.unsafe(
          "UPDATE users SET email_verified_at=now(),password_hash=NULL,session_version=session_version+1,updated_at=now() WHERE id=$1",
          [row.id]
        );
        await tx.unsafe("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [row.id]);
      }
      await tx.unsafe("INSERT INTO oauth_accounts (provider,provider_account_id,user_id,email) VALUES ($1,$2,$3,$4)", [provider, subject, row.id, email]);
      await tx.unsafe(
        "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'auth.oauth-linked','user',$1::text,$2::jsonb)",
        [row.id, JSON.stringify({ provider, passwordCleared: !row.email_verified_at })]
      );
      const fresh = await tx.unsafe("SELECT id,email,role,session_version FROM users WHERE id=$1", [row.id]);
      return { ok: true, user: asUser(fresh[0] as UserRow), created: false, newlyLinked: true };
    }

    if (!newAccountIsInvited(email,process.env)) return {ok:false,reason:"INVITE_REQUIRED"};

    const free = await tx.unsafe("SELECT id FROM plans WHERE slug='free' LIMIT 1");
    if (!free[0]) throw new Error("FREE_PLAN_MISSING");
    const created = await tx.unsafe(
      "INSERT INTO users (email,password_hash,email_verified_at) VALUES ($1,NULL,now()) RETURNING id,email,role,session_version",
      [email]
    );
    const id = String(created[0].id);
    await tx.unsafe("INSERT INTO subscriptions (user_id,plan_id,status,cadence) VALUES ($1,$2,'FREE','FREE')", [id, free[0].id]);
    await tx.unsafe("INSERT INTO oauth_accounts (provider,provider_account_id,user_id,email) VALUES ($1,$2,$3,$4)", [provider, subject, id, email]);
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'auth.oauth-registered','user',$1::text,$2::jsonb)",
      [id, JSON.stringify({ provider })]
    );
    return { ok: true, user: asUser(created[0] as UserRow), created: true };
  });
}
