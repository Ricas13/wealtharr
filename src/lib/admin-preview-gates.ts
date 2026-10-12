import "server-only";
import type { Sql } from "postgres";
import { assertCustomerPublishableEngine } from "@/domain/strategy/registry";
import { assertCuratedRules } from "@/domain/strategy/curated-release";

// Same shape as EntitlementDb: accepts the shared client and a transaction handle.
type Db = Pick<Sql, "unsafe">;

/**
 * Enforce the same immutable source-release gates for EVERY new start or switch, even if a
 * legacy version was seeded as enabled before approvals existed. Admin entitlement bypasses
 * never bypass rule integrity or missing release evidence. Existing user ledgers are untouched.
 * The historic function name is kept for compatibility with the create/switch/preview callers.
 * An attestation is a recorded operator assertion, not proof of independent methodology review.
 */
export async function assertDisabledStrategyPreviewGates(
  db: Db,
  // A database row: the fields read below are key, enabled, version_id, engine_key, config, input_schema.
  definition: Record<string, unknown>
) {
  assertCustomerPublishableEngine(String(definition.engine_key));
  assertCuratedRules(String(definition.key), String(definition.engine_key), definition.config, definition.input_schema);
  const attested = await db.unsafe(
    "SELECT 1 FROM strategy_version_attestations WHERE strategy_version_id=$1 AND attested_by_email IS NOT NULL LIMIT 1",
    [String(definition.version_id)]
  );
  if (!attested[0]) throw new Error("STRATEGY_NOT_AVAILABLE");
}
