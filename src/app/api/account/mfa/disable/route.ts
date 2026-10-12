import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireUser } from "@/lib/session";
import { sql } from "@/lib/db";
import { assertSameOrigin, consumeRateLimit } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { disableMfa, verifySecondFactor } from "@/lib/mfa";
import { notifySecurityEvent } from "@/lib/security-notice";

// Turning protection off needs both the password and a current second factor, so a stolen session
// alone cannot remove it.
const schema = z.object({ password: z.string().min(1).max(128), code: z.string().min(6).max(32) });

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await consumeRateLimit("mfa-disable:" + user.id, 10, 15 * 60);
    const input = schema.parse(await request.json());
    const rows = await sql.unsafe("SELECT password_hash,mfa_enabled_at FROM users WHERE id=$1", [user.id]);
    if (!rows[0]?.mfa_enabled_at) return Response.json({ error: "Two-step sign-in is not on." }, { status: 409 });
    const passwordOk = Boolean(rows[0].password_hash) && await bcrypt.compare(input.password, String(rows[0].password_hash));
    if (!passwordOk || !(await verifySecondFactor(user.id, input.code))) {
      return Response.json({ error: "Password or code is incorrect." }, { status: 400 });
    }
    await disableMfa(user.id);
    await notifySecurityEvent(user.id, "MFA_DISABLED");
    return Response.json({ ok: true, signInAgain: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    const code = error instanceof Error ? error.message : "";
    if (error instanceof z.ZodError) return Response.json({ error: "Enter your password and a code." }, { status: 400 });
    if (code === "RATE_LIMITED") return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    return Response.json({ error: "Could not turn off two-step sign-in." }, { status: 500 });
  }
}
