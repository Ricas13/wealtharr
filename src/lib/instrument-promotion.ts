import "server-only";
import Decimal from "decimal.js";
import { sql } from "@/lib/db";
import {
  PromotionRefused, classifyPromotion, exposureIsRegistered, subjectMatchesMapping,
  type PeerMapping, type PromoteMappingInput, type RejectMappingInput
} from "@/domain/instrument-promotion";

type Tx = Pick<typeof sql, "unsafe">;
const LOCK = "SELECT pg_advisory_xact_lock(hashtextextended('instrument-mapping-promotion',0))";
const MAPPING_SQL =
  "SELECT m.id::text AS id,m.economic_exposure,m.leverage::text AS leverage,m.direction,m.country,m.wrapper,m.broker,m.preferred_currency," +
  " m.fidelity,m.enabled,m.effective_from::text AS effective_from,m.effective_to::text AS effective_to,m.trading_line_id::text AS trading_line_id," +
  " i.id::text AS instrument_id,i.isin,i.economic_exposure AS i_exposure,i.leverage::text AS i_leverage,i.direction AS i_direction" +
  " FROM regional_instrument_mappings m JOIN trading_lines tl ON tl.id=m.trading_line_id JOIN instruments i ON i.id=tl.instrument_id" +
  " WHERE m.id=$1 FOR UPDATE OF m";

async function loadCandidate(tx: Tx, mappingId: string) {
  const rows = await tx.unsafe(MAPPING_SQL, [mappingId]);
  const row = rows[0];
  if (!row) throw new PromotionRefused("NOT_FOUND");
  if (String(row.fidelity) !== "CANDIDATE") throw new PromotionRefused("NOT_CANDIDATE");
  return row;
}

function toPeer(r: Record<string, unknown>): PeerMapping {
  return {
    id: String(r.id), economicExposure: String(r.economic_exposure), leverage: String(r.leverage), direction: String(r.direction),
    country: String(r.country), wrapper: String(r.wrapper), broker: r.broker == null ? null : String(r.broker),
    preferredCurrency: r.preferred_currency == null ? null : String(r.preferred_currency), tradingLineId: String(r.trading_line_id),
    effectiveFrom: String(r.effective_from), effectiveTo: r.effective_to == null ? null : String(r.effective_to)
  };
}

/**
 * Verifies a CANDIDATE and promotes it to EXACT in one transaction. Serialised by an advisory lock so
 * two concurrent promotions cannot create an ambiguous pair. Throws PromotionRefused (nothing written).
 */
export async function promoteCandidateMapping(actorUserId: string, input: PromoteMappingInput) {
  return sql.begin(async (tx) => {
    await tx.unsafe(LOCK);
    const row = await loadCandidate(tx, input.mappingId);
    const mapping = {
      economicExposure: String(row.economic_exposure), leverage: String(row.leverage), direction: String(row.direction),
      country: String(row.country), wrapper: String(row.wrapper), tradingLineId: String(row.trading_line_id)
    };
    if (!subjectMatchesMapping(input.subject, mapping)) throw new PromotionRefused("SUBJECT_CHANGED");
    if (!exposureIsRegistered(mapping.economicExposure)) throw new PromotionRefused("UNREGISTERED_EXPOSURE");
    let sameLeverage = false;
    try { sameLeverage = new Decimal(String(row.i_leverage)).eq(new Decimal(mapping.leverage)); } catch { sameLeverage = false; }
    if (String(row.i_exposure) !== mapping.economicExposure || String(row.i_direction) !== mapping.direction || !sameLeverage) {
      throw new PromotionRefused("INSTRUMENT_MISMATCH");
    }
    if (row.isin != null && String(row.isin) !== input.isin) throw new PromotionRefused("ISIN_MISMATCH");
    if (row.isin == null) {
      const taken = await tx.unsafe("SELECT 1 FROM instruments WHERE isin=$1 AND id<>$2::uuid", [input.isin, row.instrument_id]);
      if (taken.length) throw new PromotionRefused("ISIN_IN_USE");
    }

    const peerRows = await tx.unsafe(
      "SELECT id::text AS id,economic_exposure,leverage::text AS leverage,direction,country,wrapper,broker,preferred_currency,trading_line_id::text AS trading_line_id,effective_from::text AS effective_from,effective_to::text AS effective_to" +
      " FROM regional_instrument_mappings WHERE economic_exposure=$1 AND country=$2 AND wrapper=$3 AND enabled=true AND fidelity='EXACT' AND id<>$4::uuid",
      [mapping.economicExposure, mapping.country, mapping.wrapper, input.mappingId]
    );
    const verdict = classifyPromotion(toPeer({ ...row }), peerRows.map((r) => toPeer(r)));
    if (verdict !== "OK") throw new PromotionRefused(verdict);

    if (row.isin == null) await tx.unsafe("UPDATE instruments SET isin=$1,updated_at=now() WHERE id=$2::uuid", [input.isin, row.instrument_id]);
    if (input.providerSymbol) await tx.unsafe("UPDATE trading_lines SET provider_symbol=$1,updated_at=now() WHERE id=$2::uuid", [input.providerSymbol, row.trading_line_id]);
    const updated = await tx.unsafe(
      "UPDATE regional_instrument_mappings SET fidelity='EXACT',enabled=true,updated_at=now() WHERE id=$1::uuid AND fidelity='CANDIDATE' RETURNING id",
      [input.mappingId]
    );
    if (updated.length !== 1) throw new PromotionRefused("NOT_CANDIDATE");
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'instrument-mapping.promoted','regional_instrument_mapping',$2,$3::jsonb)",
      [actorUserId, input.mappingId, JSON.stringify({
        from: "CANDIDATE", to: "EXACT", isin: input.isin, providerSymbol: input.providerSymbol ?? null,
        subject: input.subject, checklist: input.checklist, note: input.note
      })]
    );
    return { mappingId: input.mappingId, fidelity: "EXACT" as const };
  });
}

/** Marks a CANDIDATE as REJECTED and disabled. The row and its history are kept; it never resolves. */
export async function rejectCandidateMapping(actorUserId: string, input: RejectMappingInput) {
  return sql.begin(async (tx) => {
    await tx.unsafe(LOCK);
    await loadCandidate(tx, input.mappingId);
    const updated = await tx.unsafe(
      "UPDATE regional_instrument_mappings SET fidelity='REJECTED',enabled=false,updated_at=now() WHERE id=$1::uuid AND fidelity='CANDIDATE' RETURNING id",
      [input.mappingId]
    );
    if (updated.length !== 1) throw new PromotionRefused("NOT_CANDIDATE");
    await tx.unsafe(
      "INSERT INTO audit_events (actor_user_id,action,entity_type,entity_id,metadata) VALUES ($1,'instrument-mapping.rejected','regional_instrument_mapping',$2,$3::jsonb)",
      [actorUserId, input.mappingId, JSON.stringify({ from: "CANDIDATE", to: "REJECTED", note: input.note })]
    );
    return { mappingId: input.mappingId, fidelity: "REJECTED" as const };
  });
}
