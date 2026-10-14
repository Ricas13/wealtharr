-- Administrator-confirmed corporate actions (stock splits). A provider quote that moves by a split's
-- ratio is accepted as genuine ONLY when a CONFIRMED action here explains it. A split a user records in
-- their own ledger restates that strategy's units and never explains a price for anyone else.
-- effective_date is the first trading day on which the instrument trades at post-split prices (UTC
-- date; markets whose session crosses UTC midnight are out of scope).
-- ratio_to new units for every ratio_from old units (2:1 split = 2/1; 1:10 reverse split = 1/10),
-- stored in lowest terms so the unique index cannot be dodged with 4:2 versus 2:1.
--
-- Status machine: a high-risk ratio (power of ten, or either term above 50) is proposed as PENDING by
-- one admin and becomes CONFIRMED only when a DIFFERENT admin approves it; PENDING lapses to REVOKED
-- after 7 days. Any other ratio is CONFIRMED by its creator. Only CONFIRMED rows are ever read by the
-- market worker or the holder guard.
CREATE TABLE IF NOT EXISTS corporate_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instrument_id uuid NOT NULL REFERENCES instruments(id),
  kind text NOT NULL DEFAULT 'SPLIT' CHECK (kind IN ('SPLIT')),
  ratio_to integer NOT NULL CHECK (ratio_to BETWEEN 1 AND 1000),
  ratio_from integer NOT NULL CHECK (ratio_from BETWEEN 1 AND 1000),
  effective_date date NOT NULL,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('PENDING','CONFIRMED','REVOKED')),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  revoked_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT corporate_actions_ratio_differs CHECK (ratio_to <> ratio_from),
  CONSTRAINT corporate_actions_ratio_reduced CHECK (gcd(ratio_to, ratio_from) = 1),
  CONSTRAINT corporate_actions_confirmed_complete CHECK (status <> 'CONFIRMED' OR (confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS corporate_actions_open_unique
  ON corporate_actions (instrument_id, kind, effective_date, ratio_to, ratio_from) WHERE status IN ('PENDING','CONFIRMED');
CREATE INDEX IF NOT EXISTS corporate_actions_instrument_idx
  ON corporate_actions (instrument_id, effective_date) WHERE status = 'CONFIRMED';

-- An accepted observation that was only valid because an action explained it is linked to that
-- action; revoking the action deletes those observations in the same transaction.
ALTER TABLE market_data_observations
  ADD COLUMN IF NOT EXISTS explained_by_corporate_action_id uuid REFERENCES corporate_actions(id);
CREATE INDEX IF NOT EXISTS market_data_observations_explained_idx
  ON market_data_observations (explained_by_corporate_action_id) WHERE explained_by_corporate_action_id IS NOT NULL;
