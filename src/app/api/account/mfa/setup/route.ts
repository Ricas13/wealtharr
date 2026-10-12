import { z } from "zod";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { beginEnrollment, isMfaEnabled } from "@/lib/mfa";
import { reauthenticate } from "@/lib/reauth";
import { otpauthUri } from "@/domain/totp";

// Starting enrolment replaces any half-finished secret, so it needs the current password.
const schema = z.object({ password: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    if (await isMfaEnabled(user.id)) return Response.json({ error: "Two-step sign-in is already on." }, { status: 409 });
    const input = schema.parse(await request.json().catch(() => ({})));
    const outcome = await reauthenticate(user, { password: input.password }, { scope: "mfa-setup" });
    if (outcome === "NO_PASSWORD") return Response.json({ error: "Set a password first (use Forgot password on the sign-in page), then turn on two-step sign-in." }, { status: 409 });
    if (outcome !== "OK") return Response.json({ error: "Password is incorrect." }, { status: 400 });
    const secret = await beginEnrollment(user.id);
    const issuer = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Wealtharr";
    return Response.json({ secret, otpauthUri: otpauthUri(secret, user.email, issuer) }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "Enter your password." }, { status: 400 });
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    if (error instanceof Error && error.message === "MFA_ALREADY_ENABLED") return Response.json({ error: "Two-step sign-in is already on." }, { status: 409 });
    if (error instanceof Error && error.message === "MFA_PASSWORD_REQUIRED") return Response.json({ error: "Set a password first (use Forgot password on the sign-in page), then turn on two-step sign-in." }, { status: 409 });
    return Response.json({ error: "Could not start two-step sign-in setup." }, { status: 500 });
  }
}
