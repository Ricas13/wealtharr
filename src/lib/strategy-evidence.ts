import "server-only";
import { sql } from "@/lib/db";

export type StrategyEvidenceRow = { key: string; name: string; version: string; lifecycle: string; attested: boolean };

/**
 * Customer-visible strategy versions (the current published version of every enabled strategy) and
 * whether a person has recorded a specification sign-off for each. An attestation only records that a
 * named administrator signed a specification card; it does not verify the card itself.
 */
export async function customerStrategyEvidence(): Promise<StrategyEvidenceRow[]> {
  const rows = await sql.unsafe(
    "SELECT d.key,d.name,v.version,v.lifecycle_status,EXISTS(SELECT 1 FROM strategy_version_attestations a WHERE a.strategy_version_id=v.id) AS attested " +
    "FROM strategy_definitions d JOIN LATERAL (SELECT * FROM strategy_versions v WHERE v.strategy_definition_id=d.id AND v.lifecycle_status='PUBLISHED' " +
    "AND v.effective_from<=current_date AND (v.effective_to IS NULL OR v.effective_to>=current_date) ORDER BY v.effective_from DESC,v.published_at DESC NULLS LAST LIMIT 1) v ON true " +
    "WHERE d.enabled=true ORDER BY d.key"
  );
  return rows.map((r) => ({ key: String(r.key), name: String(r.name), version: String(r.version), lifecycle: String(r.lifecycle_status), attested: Boolean(r.attested) }));
}

export async function unattestedCustomerStrategies() {
  return (await customerStrategyEvidence()).filter((row) => !row.attested);
}
