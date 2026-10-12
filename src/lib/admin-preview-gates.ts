import "server-only";
import type { Sql } from "postgres";
import { assertCustomerPublishableEngine } from "@/domain/strategy/registry";
import { assertCuratedRules } from "@/domain/strategy/curated-release";

// Same shape as EntitlementDb: accepts the shared client and a transaction handle.
type Db = Pick<Sql, "unsafe">;

/**
 * Check executable, code-owned strategy rules for ALL new starts and switches.
 * Administrative attestations are optional audit metadata, NOT an activation prerequisite.
 * Global enablement, plan/user entitlements and verified broker/wrapper mapping are
 * separately enforced by the calling services.
 */
export async function assertDisabledStrategyPreviewGates(
  db: Db,
  // A database row: the fields read below are key, enabled, version_id, engine_key, config, input_schema.
  definition: Record<string, unknown>
) {
  void db; // Preserve the transaction-shaped interface used by all callers.
  assertCustomerPublishableEngine(String(definition.engine_key));
  assertCuratedRules(String(definition.key), String(definition.engine_key), definition.config, definition.input_schema);

}
