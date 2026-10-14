import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { sql } from "@/lib/db";
import { ensureSettings } from "@/lib/settings";
import { adminAccessDecision } from "@/domain/admin-access";

export async function requireUser() {
  await ensureSettings();
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  const rows = await sql.unsafe(
    "SELECT id,email,country,base_currency,timezone,role,anonymous_aggregate_opt_in,session_version,mfa_enabled_at FROM users WHERE id=$1 AND deleted_at IS NULL LIMIT 1",
    [session.user.id]
  );
  if (!rows[0]) throw new Error("UNAUTHENTICATED");
  // A password reset or a change to two-step sign-in bumps the stored version, which invalidates
  // every older session.
  if (Number(rows[0].session_version ?? 0) !== session.user.sessionVersion) throw new Error("UNAUTHENTICATED");
  return {
    id: String(rows[0].id),
    email: String(rows[0].email),
    country: String(rows[0].country),
    baseCurrency: String(rows[0].base_currency),
    timezone: String(rows[0].timezone),
    role: String(rows[0].role),
    anonymousAggregateOptIn: Boolean(rows[0].anonymous_aggregate_opt_in),
    // Two-step sign-in is on for the account (database) and whether this session passed it (token).
    mfaEnabled: Boolean(rows[0].mfa_enabled_at),
    sessionMfa: session.user.mfa === true,
    // Epoch milliseconds of the sign-in that created this session; 0 for sessions that predate it.
    authTime: Number(session.user.authTime ?? 0)
  };
}

export async function requireAdmin() {
  const user = await requireUser();
  // When the operator requires it, an admin without two-step sign-in is kept out of the control
  // plane (but not out of their own account, where they can turn it on, so nobody is locked out).
  // An admin who has it on must also have passed it in this very session.
  const decision = adminAccessDecision({
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    sessionMfa: user.sessionMfa,
    mfaRequired: process.env.ADMIN_MFA_REQUIRED === "true"
  });
  if (decision === "FORBIDDEN") throw new Error("FORBIDDEN");
  if (decision === "MFA_REQUIRED") throw new Error("MFA_REQUIRED");
  // Reported like an expired session: the answer is to sign in again, this time with the code.
  if (decision === "REAUTH_REQUIRED") throw new Error("UNAUTHENTICATED");
  return user;
}

// For actions whose effect reaches every customer (for example confirming a corporate action):
// two-step sign-in must be enabled on the account AND passed in this session, regardless of the
// ADMIN_MFA_REQUIRED operator setting.
export async function requireAdminWithMfa() {
  const user = await requireAdmin();
  if (!user.mfaEnabled || !user.sessionMfa) throw new Error("MFA_REQUIRED");
  return user;
}

// For server-rendered pages and layouts: a missing, deleted or revoked session (for example
// after a password reset on another device) sends the user to sign in instead of an error page.
export async function requirePageUser() {
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") redirect("/login");
    throw error;
  }
}

// Every admin page calls this itself. The admin layout also calls it, but Next.js can render a
// page without re-running an unchanged parent layout, so the layout alone is not a guard.
// Non-admins go back to their workspace; an admin the operator requires to use two-step sign-in
// goes to their security settings.
export async function requireAdminPage() {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "UNAUTHENTICATED") redirect("/login");
      if (error.message === "FORBIDDEN") redirect("/app");
      if (error.message === "MFA_REQUIRED") redirect("/app/settings#security");
    }
    throw error;
  }
}
