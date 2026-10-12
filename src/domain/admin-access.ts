export type AdminAccessInput = {
  role: string;
  /** The account has two-step sign-in turned on (database, authoritative). */
  mfaEnabled: boolean;
  /** This session was created by a sign-in that verified a second factor (token claim). */
  sessionMfa: boolean;
  /** The operator requires two-step sign-in for admins (ADMIN_MFA_REQUIRED). */
  mfaRequired: boolean;
};

export type AdminAccessDecision = "OK" | "FORBIDDEN" | "MFA_REQUIRED" | "REAUTH_REQUIRED";

/**
 * Decides whether a signed-in session may use admin tools. Fails closed:
 * - not an admin: FORBIDDEN;
 * - the operator requires two-step sign-in and the admin has not enrolled: MFA_REQUIRED (they can
 *   still reach their own account to enrol, so nobody is locked out);
 * - the admin has two-step sign-in on but this session did not pass it (a session that predates
 *   enrolment, or was opened some other way): REAUTH_REQUIRED, i.e. sign in again with the code.
 */
export function adminAccessDecision(input: AdminAccessInput): AdminAccessDecision {
  if (input.role !== "ADMIN") return "FORBIDDEN";
  if (input.mfaRequired && !input.mfaEnabled) return "MFA_REQUIRED";
  if (input.mfaEnabled && !input.sessionMfa) return "REAUTH_REQUIRED";
  return "OK";
}

/** How recent a sign-in must be to count as fresh proof of identity for a sensitive action. */
export const RECENT_SIGN_IN_MS = 15 * 60 * 1000;

/** `authTime` is the epoch-millisecond sign-in time carried in the session token (0 when absent). */
export function signedInRecently(authTime: number, now: number = Date.now()): boolean {
  if (!Number.isFinite(authTime) || authTime <= 0) return false;
  if (authTime > now + 60_000) return false; // a time in the future is not trustworthy
  return now - authTime <= RECENT_SIGN_IN_MS;
}
