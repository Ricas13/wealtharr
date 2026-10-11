-- Status changes (acknowledgement, notification) must not refresh the ledger
-- snapshot against which an instruction was calculated. Existing actions use
-- their creation time conservatively until the next genuine calculation.
ALTER TABLE actions ADD COLUMN calculated_at timestamptz;
UPDATE actions SET calculated_at=created_at;
ALTER TABLE actions ALTER COLUMN calculated_at SET DEFAULT clock_timestamp();
ALTER TABLE actions ALTER COLUMN calculated_at SET NOT NULL;
