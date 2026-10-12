import "server-only";
import type { Sql } from "postgres";
import { assertCustomerPublishableEngine } from "@/domain/strategy/registry";
import { assertCuratedRules } from "@/domain/strategy/curated-release";

// Same shape as EntitlementDb: accepts the shared client and a transaction handle.
type Db = Pick<Sql, "unsafe">;

/**
 * An admin may start a strategy whose definition is still disabled, but only if its release would
 * pass the same gates that enabling it requires: a customer-publishable engine, rules identical to
 * the reviewed code release, and an attestation recorded for this exact version. A legacy PUBLISHED
 * version that was never attested (migration 0005 published everything that pre-dated it) is
 * therefore refused here too. Enabled definitions are unaffected: they already passed these gates.
 */
export async function assertDisabledStrategyPreviewGates(
  db: Db,
  definition: { key: unknown; enabled: unknown; version_id: unknown; engine_key: unknown; config: unknown; input_schema: unknown }
) {
  if (definition.enabled === true) return;
  assertCustomerPublishableEngine(String(definition.engine_key));
  assertCuratedRules(String(definition.key), String(definition.engine_key), definition.config, definition.input_schema);
  const attested = await db.unsafe(
    "SELECT 1 FROM strategy_version_attestations WHERE strategy_version_id=$1 LIMIT 1",
    [String(definition.version_id)]
  );
  if (!attested[0]) throw new Error("STRATEGY_NOT_AVAILABLE");
}
