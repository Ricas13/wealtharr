-- Administrator-confirmed corporate actions (stock splits). A provider quote that moves by a split's
-- ratio is accepted as genuine ONLY when a CONFIRMED action here explains it. A split a user records in
-- their own ledger restates that strategy's units and never explains a price for anyone else.
-- effective_date is the first trading day on which the instrument trades at post-split prices.
-- ratio_to new units for every ratio_from old units (2:1 split = 2/1; 1:10 reverse split = 1/10).
CREATE TABLE IF NOT EXISTS corporate_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  kind text NOT NULL DEFAULT 'SPLIT' CHECK (kind IN ('SPLIT')),
  ratio_to integer NOT NULL CHECK (ratio_to BETWEEN 1 AND 1000),
  ratio_from integer NOT NULL CHECK (ratio_from BETWEEN 1 AND 1000),
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','REVOKED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  confirmed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corporate_actions_ratio_differs CHECK (ratio_to <> ratio_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS corporate_actions_confirmed_unique
  ON corporate_actions (instrument_id, kind, effective_date, ratio_to, ratio_from) WHERE status = 'CONFIRMED';
CREATE INDEX IF NOT EXISTS corporate_actions_instrument_idx
  ON corporate_actions (instrument_id, effective_date) WHERE status = 'CONFIRMED';
