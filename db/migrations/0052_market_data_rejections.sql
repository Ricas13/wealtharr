-- Fail closed when a provider supplies a post-split/pence-pound quote that plausibility rejects.
-- Without this table, the last accepted pre-event price could still produce a wrong rebalance.
-- Only retain the newest rejected observation per instrument line; no arbitrary provider payloads.
CREATE TABLE IF NOT EXISTS market_data_rejections (
  trading_line_id uuid PRIMARY KEY REFERENCES trading_lines(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  price numeric(24,10) NOT NULL,
  currency text NOT NULL,
  provider text NOT NULL,
  reason text NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ledger_events_split_idx
  ON ledger_events (instrument_id, occurred_at) WHERE event_type='SPLIT';
