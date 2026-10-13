-- Evidence an operator recorded when verifying a mapping (documents, hashes, ISA basis, listing,
-- broker snapshot). Shape and completeness rules live in src/domain/instrument-evidence.ts and are
-- enforced server-side at promotion; the database only guarantees a JSON object so legacy rows stay
-- valid. '{}' means "no evidence recorded": existing EXACT mappings are NOT changed or demoted.
ALTER TABLE regional_instrument_mappings ADD COLUMN IF NOT EXISTS evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regional_mapping_evidence_object_check') THEN
    ALTER TABLE regional_instrument_mappings
      ADD CONSTRAINT regional_mapping_evidence_object_check CHECK (jsonb_typeof(evidence) = 'object');
  END IF;
END $$;
