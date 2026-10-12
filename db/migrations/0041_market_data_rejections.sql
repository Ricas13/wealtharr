-- The newest provider quote per trading line that was REFUSED as implausible (for example a 2:1
-- split halving the price). Rejected quotes are never written to market_data_observations, so
-- without this record the previous accepted price would silently stay "latest" and actions would be
-- sized from a price describing a different share count. Calculation compares this row's observed_at
-- with the latest accepted observation and fails closed (DATA_REQUIRED) while the rejection is newer.
-- One row per line, replaced by each newer rejection; it stops mattering once a newer quote is
-- accepted, so the table never grows.
CREATE TABLE IF NOT EXISTS market_data_rejections (
  trading_line_id uuid PRIMARY KEY REFERENCES trading_lines(id) ON DELETE CASCADE,
  observed_at timestamptz NOT NULL,
  price numeric(24,10) NOT NULL,
  currency text NOT NULL,
  provider text NOT NULL,
  reason text NOT NULL,
  rejected_at timestamptz NOT NULL DEFAULT now()
);

-- The market-data worker asks, per observation, whether a SPLIT was recorded for the instrument
-- after it. Keep that lookup off a sequential scan of the whole ledger.
CREATE INDEX IF NOT EXISTS ledger_events_split_idx ON ledger_events(instrument_id, occurred_at) WHERE event_type = 'SPLIT';
