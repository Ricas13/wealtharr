import "server-only";
import { sql } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { generateRecoveryCodes, generateTotpSecret, hashRecoveryCode, looksLikeRecoveryCode, verifyTotp } from "@/domain/totp";

export async function isMfaEnabled(userId: string) {
  const rows = await sql.unsafe("SELECT mfa_enabled_at FROM users WHERE id=$1", [userId]);
  return Boolean(rows[0]?.mfa_enabled_at);
}

/**
 * Checks an authenticator code or a one-time recovery code for a user who has two-step sign-in on.
 * Runs under a row lock so two parallel sign-ins cannot both spend the same code.
 */
export async function verifySecondFactor(userId: string, submitted: string | undefined, now = new Date()): Promise<boolean> {
  const code = (submitted ?? "").trim();
  if (!code) return false;
  return sql.begin(async (tx) => {
    const rows = await tx.unsafe(
      "SELECT mfa_secret_encrypted,mfa_enabled_at,mfa_last_step,mfa_recovery_hashes FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );
    const user = rows[0];
    if (!user?.mfa_enabled_at || !user.mfa_secret_encrypted) return false;
    if (looksLikeRecoveryCode(code)) {
      const hash = hashRecoveryCode(code);
      const hashes: string[] = user.mfa_recovery_hashes ?? [];
      if (!hashes.includes(hash)) return false;
      await tx.unsafe("UPDATE users SET mfa_recovery_hashes=array_remove(mfa_recovery_hashes,$2),updated_at=now() WHERE id=$1", [userId, hash]);
      await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'auth.recovery-code-used','user',$1::text,$2::jsonb)", [userId, JSON.stringify({ remaining: hashes.length - 1 })]);
      return true;
    }
    const step = verifyTotp(decryptSecret(String(user.mfa_secret_encrypted)), code, now, Number(user.mfa_last_step));
    if (step == null) return false;
    await tx.unsafe("UPDATE users SET mfa_last_step=$2 WHERE id=$1", [userId, step]);
    return true;
  });
}

/** Starts (or restarts) enrolment. Nothing is enforced until confirmEnrollment succeeds. */
export async function beginEnrollment(userId: string) {
  // Provider sign-in is refused for accounts with two-step sign-in on, so an account with no
  // password would lock itself out. It must set a password first (forgot password).
  const owner = await sql.unsafe("SELECT password_hash FROM users WHERE id=$1", [userId]);
  if (!owner[0]?.password_hash) throw new Error("MFA_PASSWORD_REQUIRED");
  const secret = generateTotpSecret();
  const updated = await sql.unsafe(
    "UPDATE users SET mfa_secret_encrypted=$2,updated_at=now() WHERE id=$1 AND mfa_enabled_at IS NULL RETURNING id",
    [userId, encryptSecret(secret)]
  );
  if (!updated[0]) throw new Error("MFA_ALREADY_ENABLED");
  return secret;
}

export async function confirmEnrollment(userId: string, code: string, now = new Date()) {
  return sql.begin(async (tx) => {
    const rows = await tx.unsafe("SELECT mfa_secret_encrypted,mfa_enabled_at FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const user = rows[0];
    if (!user) throw new Error("UNAUTHENTICATED");
    if (user.mfa_enabled_at) throw new Error("MFA_ALREADY_ENABLED");
    if (!user.mfa_secret_encrypted) throw new Error("MFA_NOT_STARTED");
    const step = verifyTotp(decryptSecret(String(user.mfa_secret_encrypted)), code, now);
    if (step == null) throw new Error("MFA_CODE_INVALID");
    const recoveryCodes = generateRecoveryCodes();
    await tx.unsafe(
      "UPDATE users SET mfa_enabled_at=now(),mfa_last_step=$2,mfa_recovery_hashes=$3::text[],session_version=session_version+1,updated_at=now() WHERE id=$1",
      [userId, step, recoveryCodes.map(hashRecoveryCode)]
    );
    await tx.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'auth.mfa-enabled','user',$1::text,'{}'::jsonb)", [userId]);
    return recoveryCodes;
  });
}

export async function disableMfa(userId: string) {
  await sql.unsafe(
    "UPDATE users SET mfa_secret_encrypted=NULL,mfa_enabled_at=NULL,mfa_last_step=-1,mfa_recovery_hashes='{}',session_version=session_version+1,updated_at=now() WHERE id=$1",
    [userId]
  );
  await sql.unsafe("INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1::uuid,'auth.mfa-disabled','user',$1::text,'{}'::jsonb)", [userId]);
}
