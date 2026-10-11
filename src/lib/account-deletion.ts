import "server-only";
import { safeErrorCode } from "@/lib/safe-error-code";
import Stripe from "stripe";
import { sql } from "@/lib/db";

// Account deletion is a small state machine so a failure at any step can never leave a live
// account whose billing has already been destroyed:
//
//   1. begin   - mark users.deleted_at. Every auth/session/strategy path treats that as "gone",
//                so the user is locked out and calculations stop immediately. Nothing external has
//                happened yet, so this step cannot strand billing.
//   2. finish  - disconnect Stripe (idempotent: an already-deleted customer counts as done), then
//                purge the data. If Stripe or the purge fails the account simply stays closed and
//                the hourly worker retries (finishPendingAccountDeletions).

export type BeginOutcome = "STARTED" | "BILLING_NOT_CONFIGURED";
export type FinishOutcome = "DELETED" | "PENDING";

async function billingIdentity(userId: string) {
  const rows = await sql.unsafe(
    "SELECT stripe_customer_id,stripe_subscription_id FROM subscriptions WHERE user_id=$1 LIMIT 1",
    [userId]
  );
  const customerId = rows[0]?.stripe_customer_id ? String(rows[0].stripe_customer_id) : null;
  const subscriptionId = rows[0]?.stripe_subscription_id ? String(rows[0].stripe_subscription_id) : null;
  return { customerId, subscriptionId, hasStripe: Boolean(customerId || subscriptionId) };
}

async function disconnectBilling(userId: string) {
  const { customerId, subscriptionId, hasStripe } = await billingIdentity(userId);
  if (!hasStripe) return;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_NOT_CONFIGURED");
  const stripe = new Stripe(key);
  try {
    if (customerId) await stripe.customers.del(customerId);
    else if (subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (subscription.status !== "canceled") await stripe.subscriptions.cancel(subscription.id);
    }
  } catch (error) {
    // Already gone at Stripe: a retry after a partial failure must carry on, not fail forever.
    if ((error as { code?: string })?.code !== "resource_missing") throw error;
  }
}

export async function beginAccountDeletion(userId: string): Promise<BeginOutcome> {
  // If billing exists but cannot be reached at all, do not lock the user out of an account we
  // cannot finish closing: tell them instead (the pre-existing behaviour).
  if ((await billingIdentity(userId)).hasStripe && !process.env.STRIPE_SECRET_KEY) return "BILLING_NOT_CONFIGURED";
  await sql.begin(async (tx) => {
    const marked = await tx.unsafe(
      "UPDATE users SET deleted_at=COALESCE(deleted_at,now()),updated_at=now() WHERE id=$1 RETURNING id",
      [userId]
    );
    if (!marked[0]) throw new Error("UNAUTHENTICATED");
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id) VALUES ($1,'account.deletion-requested','user',$2)",
      [userId,userId]
    );
  });
  return "STARTED";
}

export async function finishAccountDeletion(userId: string): Promise<FinishOutcome> {
  try {
    await disconnectBilling(userId);
  } catch (error) {
    await sql.unsafe(
      "INSERT INTO audit_events (action,entity_type,entity_id,metadata) VALUES ('account.deletion-stalled','user',$1,$2::jsonb)",
      [userId, JSON.stringify({ errorCode: safeErrorCode(error) })]
    ).catch(() => {});
    return "PENDING";
  }
  try {
    await sql.begin(async (tx) => {
      // Only an account that was marked deleted may be purged.
      const removed = await tx.unsafe("DELETE FROM users WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id", [userId]);
      if (removed[0]) {
        await tx.unsafe(
          "INSERT INTO audit_events (action,entity_type,metadata) VALUES ('account.deleted','user',$1::jsonb)",
          [JSON.stringify({ selfService: true })]
        );
      }
    });
    return "DELETED";
  } catch (error) {
    await sql.unsafe(
      "INSERT INTO audit_events (action,entity_type,entity_id,metadata) VALUES ('account.deletion-stalled','user',$1,$2::jsonb)",
      [userId, JSON.stringify({ errorCode: safeErrorCode(error) })]
    ).catch(() => {});
    return "PENDING";
  }
}

// Completes deletions that stalled. The grace period keeps the worker from racing a request that
// is still finishing its own deletion.
export async function finishPendingAccountDeletions(limit = 25) {
  const pending = await sql.unsafe(
    "SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '2 minutes' ORDER BY deleted_at LIMIT $1",
    [limit]
  );
  let completed = 0;
  let stalled = 0;
  for (const row of pending) {
    if ((await finishAccountDeletion(String(row.id))) === "DELETED") completed += 1;
    else stalled += 1;
  }
  return { completed, stalled };
}
