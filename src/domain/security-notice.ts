// Plain-text emails sent after a change to how an account is protected, so the owner hears about it
// even if someone else made it. Wording avoids links on purpose: nothing here is a call to click.
export type SecurityNoticeKind = "PASSWORD_CHANGED" | "MFA_ENABLED" | "MFA_DISABLED" | "SIGN_IN_METHOD_ADDED" | "NEW_DEVICE_SIGN_IN" | "ADMIN_ROLE_GRANTED";

const BODY: Record<SecurityNoticeKind, { subject: string; what: string }> = {
  PASSWORD_CHANGED: { subject: "Your password was changed", what: "The password for your account was just changed, and every device was signed out." },
  MFA_ENABLED: { subject: "Two-step sign-in was turned on", what: "Two-step sign-in was just turned on for your account." },
  MFA_DISABLED: { subject: "Two-step sign-in was turned off", what: "Two-step sign-in was just turned off for your account." },
  NEW_DEVICE_SIGN_IN: { subject: "New sign-in to your account", what: "Your account was just signed in to from a browser or device we have not seen before." },
  ADMIN_ROLE_GRANTED: { subject: "Administrator access was granted to your account", what: "An existing administrator granted your account administrator access. All previous sessions were invalidated. To use Admin, sign in again with your two-step verification. If you did not agree to this change, contact your operator immediately and reset your password." },
  SIGN_IN_METHOD_ADDED: { subject: "A new way to sign in was added", what: "A sign-in provider (such as Google or Apple) was just linked to your account." }
};

export function buildSecurityNotice(kind: SecurityNoticeKind, brand: string, detail?: string) {
  const { subject, what } = BODY[kind];
  const extra = detail ? `\n\nDetail: ${detail.replace(/[\r\n]+/g, " ").slice(0, 80)}` : "";
  return {
    subject: `${brand}: ${subject}`,
    text: `${what}${extra}\n\nIf this was you, there is nothing to do.\n\nIf it was not you, reset your password straight away from the sign-in page, then check your account settings. Anyone who can read your email could also reset your password, so secure your email account as well.`
  };
}
