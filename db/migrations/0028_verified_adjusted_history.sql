-- Earlier ingestion accepted a plain daily CLOSE as if it proved a corporate-action
-- adjusted close. Preserve price history but fail closed: legacy rows default to FALSE,
-- and cannot produce trusted strategy signals until individually revalidated by the
-- updated provider contract (corporateActionsAdjusted: true).
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS adjustment_verified boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS price_history_verified_line_day_idx
  ON price_history(trading_line_id,trading_day DESC)
  WHERE licensed=true AND adjustment_verified=true;
