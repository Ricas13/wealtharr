-- Only explicitly confirmed Trading 212 transactions may be claimed by a Wealtharr strategy.
-- No account-wide holdings, unselected CSV rows, API credentials, or automatic ledger entries
-- are stored here. One external transaction can never belong to two strategies of one user.
CREATE TABLE IF NOT EXISTS broker_trade_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_instance_id uuid NOT NULL REFERENCES strategy_instances(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  ledger_event_id uuid NOT NULL UNIQUE REFERENCES ledger_events(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider = 'TRADING212'),
  external_account_ref text NOT NULL CHECK (length(external_account_ref) BETWEEN 4 AND 120),
  external_trade_id text NOT NULL CHECK (length(external_trade_id) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,provider,external_account_ref,external_trade_id)
);
CREATE INDEX IF NOT EXISTS broker_trade_links_strategy_idx
  ON broker_trade_links (strategy_instance_id,created_at DESC);

-- Defence in depth: direct SQL cannot claim somebody else's ledger entry, an unlinked
-- account or an arbitrary contribution as evidence for a different strategy.
CREATE OR REPLACE FUNCTION broker_trade_links_validate_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ledger_events le
      JOIN strategy_instances si ON si.id=le.strategy_instance_id
      JOIN strategy_accounts sa ON sa.strategy_instance_id=si.id AND sa.account_id=NEW.account_id
      JOIN accounts a ON a.id=NEW.account_id AND a.user_id=si.user_id
    WHERE le.id=NEW.ledger_event_id
      AND le.strategy_instance_id=NEW.strategy_instance_id
      AND le.account_id=NEW.account_id
      AND si.user_id=NEW.user_id
      AND le.event_type IN ('BUY','SELL')
  ) THEN
    RAISE EXCEPTION 'BROKER_TRADE_LINK_SCOPE_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS broker_trade_links_scope_guard ON broker_trade_links;
CREATE TRIGGER broker_trade_links_scope_guard
BEFORE INSERT OR UPDATE ON broker_trade_links
FOR EACH ROW EXECUTE FUNCTION broker_trade_links_validate_scope();
