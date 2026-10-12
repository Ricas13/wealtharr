import { z } from "zod";
import { requireUser } from "@/lib/session";
import { assertSameOrigin } from "@/lib/security";
import { authFailure } from "@/lib/api-auth";
import { reauthenticate } from "@/lib/reauth";
import { beginAccountDeletion, finishAccountDeletion } from "@/lib/account-deletion";

// Deleting the account is irreversible, so a session alone is not enough: the current password
// (and a current code when two-step sign-in is on). Accounts that only ever signed in through a
// provider have no password; they must have signed in within the last 15 minutes and type their
// account email.
const schema = z.object({
  password: z.string().max(128).optional(),
  code: z.string().max(32).optional(),
  confirmEmail: z.string().max(320).optional()
});

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const input = schema.parse(await request.json().catch(() => ({})));
    const outcome = await reauthenticate(user, input, { scope: "account-delete", allowEmailConfirmation: true });
    if (outcome === "SIGN_IN_AGAIN") {
      return Response.json({ error: "For your security, sign out, sign in again and retry within 15 minutes.", code: "SIGN_IN_AGAIN" }, { status: 403 });
    }
    if (outcome !== "OK") {
      return Response.json({ error: "The password, code or email you entered is not correct." }, { status: 400 });
    }
    const started = await beginAccountDeletion(user.id);
    if (started === "BILLING_NOT_CONFIGURED") {
      return Response.json({ error: "Billing must be disconnected before this account can be deleted." }, { status: 503 });
    }
    // The account is already closed to the user at this point. If Stripe or the purge cannot finish
    // right now, the hourly worker completes it, so report that honestly instead of failing.
    const finished = await finishAccountDeletion(user.id);
    return Response.json({ ok: true, completed: finished === "DELETED" }, { status: finished === "DELETED" ? 200 : 202 });
  } catch (error) {
    const denied = authFailure(error);
    if (denied) return denied;
    if (error instanceof z.ZodError) return Response.json({ error: "The password, code or email you entered is not correct." }, { status: 400 });
    if (error instanceof Error && error.message === "RATE_LIMITED") return Response.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    return Response.json({ error: "Could not delete account." }, { status: 500 });
  }
}
