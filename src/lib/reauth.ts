import "server-only";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { consumeRateLimit } from "@/lib/security";
import { verifySecondFactor } from "@/lib/mfa";
import { signedInRecently } from "@/domain/admin-access";

export type ReauthInput = { password?: string; code?: string; confirmEmail?: string };

/**
 * OK: proven.
 * INVALID: wrong or missing password, code or typed email.
 * NO_PASSWORD: the account has no password and this action does not accept the provider route.
 * SIGN_IN_AGAIN: an account with no password (provider sign-in only) has not signed in recently.
 */
export type ReauthOutcome = "OK" | "INVALID" | "NO_PASSWORD" | "SIGN_IN_AGAIN";

/**
 * Re-authentication for sensitive account actions, so a stolen or left-open session alone is not
 * enough. Throws RATE_LIMITED after too many attempts (failures and successes both count).
 *
 * - Accounts with a password: the current password, and, when two-step sign-in is on, a current
 *   authenticator or recovery code. The password is checked first, so a wrong password never spends
 *   a one-time code.
 * - Accounts with no password (created through Google or Apple): only when `allowEmailConfirmation`
 *   is set. They must have signed in within the last 15 minutes and type their account email. That
 *   is weaker than a password: whoever holds the open session within that window and knows the
 *   email can act. Such accounts cannot have two-step sign-in (provider sign-in is refused for it).
 */
export async function reauthenticate(
  user: { id: string; email: string; authTime: number },
  input: ReauthInput,
  options: { scope: string; allowEmailConfirmation?: boolean }
): Promise<ReauthOutcome> {
  await consumeRateLimit("reauth:" + options.scope + ":" + user.id, 10, 15 * 60);
  const rows = await sql.unsafe("SELECT password_hash,mfa_enabled_at FROM users WHERE id=$1 AND deleted_at IS NULL", [user.id]);
  const row = rows[0];
  if (!row) return "INVALID";
  if (row.password_hash) {
    if (!input.password || !(await bcrypt.compare(input.password, String(row.password_hash)))) return "INVALID";
  } else {
    if (!options.allowEmailConfirmation) return "NO_PASSWORD";
    if (!signedInRecently(user.authTime)) return "SIGN_IN_AGAIN";
    if ((input.confirmEmail ?? "").trim().toLowerCase() !== user.email.trim().toLowerCase()) return "INVALID";
  }
  if (row.mfa_enabled_at && !(await verifySecondFactor(user.id, input.code))) return "INVALID";
  return "OK";
}
