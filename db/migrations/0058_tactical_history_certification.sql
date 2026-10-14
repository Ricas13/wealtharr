-- Group 4 provenance, independent from a price being merely "adjusted".
-- Existing observations remain unverified. Never backfill the booleans to true.
ALTER TABLE price_history
  ADD COLUMN IF NOT EXISTS session_calendar_certified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS month_terminal_certified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_return_certified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS source_calendar text,
  ADD COLUMN IF NOT EXISTS provider_corporate_actions_revision text;
ALTER TABLE price_history ADD CONSTRAINT price_history_session_calendar_required
  CHECK (NOT session_calendar_certified OR (source_calendar IS NOT NULL AND length(trim(source_calendar))>0));
ALTER TABLE price_history ADD CONSTRAINT price_history_total_return_revision_required
  CHECK (NOT total_return_certified OR (provider_corporate_actions_revision IS NOT NULL AND length(trim(provider_corporate_actions_revision))>0));
COMMENT ON COLUMN price_history.session_calendar_certified IS
 'Provider attestation: this date is a completed, actual trading session for its exchange calendar, including monthly terminal sessions';
COMMENT ON COLUMN price_history.total_return_certified IS
 'Provider attestation: the adjusted close represents a consistently reconstructed dividends-reinvested total-return series';
\nALTER TABLE price_history ADD CONSTRAINT price_history_terminal_session_requires_calendar CHECK (NOT month_terminal_certified OR session_calendar_certified);\n