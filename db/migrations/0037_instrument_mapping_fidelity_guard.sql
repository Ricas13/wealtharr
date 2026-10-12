-- A mapping only drives trade instructions once a person has verified it (fidelity EXACT). Make the safe
-- value the default so a forgotten column can never silently create a tradable mapping, and constrain
-- the vocabulary. The check is NOT VALID so any legacy row is left untouched; it applies to new writes.
ALTER TABLE regional_instrument_mappings ALTER COLUMN fidelity SET DEFAULT 'CANDIDATE';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'regional_mapping_fidelity_check') THEN
    ALTER TABLE regional_instrument_mappings
      ADD CONSTRAINT regional_mapping_fidelity_check CHECK (fidelity IN ('EXACT','CANDIDATE','REJECTED')) NOT VALID;
  END IF;
END $$;
