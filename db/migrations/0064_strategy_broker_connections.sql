-- Strategy-scoped, consented Trading 212 read-only verification. No account-wide
-- holdings, unassigned orders, or broker cash is stored or used in rule calculations.
CREATE TABLE IF NOT EXISTS strategy_broker_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_instance_id uuid NOT NULL REFERENCES strategy_instances(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'TRADING212' CHECK (provider='TRADING212'),
  environment text NOT NULL CHECK (environment IN ('demo','live')),
  external_account_ref text NOT NULL CHECK (length(external_account_ref) BETWEEN 1 AND 120),
  account_currency text NOT NULL CHECK (account_currency ~ '^[A-Z]{3}$'),
  api_key_encrypted text NOT NULL,
  api_secret_encrypted text NOT NULL,
  consented_read_only_at timestamptz NOT NULL,
  last_synced_at timestamptz,
  last_sync_status text NOT NULL DEFAULT 'NOT_SYNCED' CHECK(last_sync_status IN ('NOT_SYNCED','VERIFIED','NEEDS_RECONCILIATION','ERROR')),
  last_sync_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(strategy_instance_id,provider)
);
CREATE INDEX IF NOT EXISTS strategy_broker_connections_user_idx ON strategy_broker_connections(user_id,strategy_instance_id);
CREATE OR REPLACE FUNCTION broker_connection_owner_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM strategy_instances i WHERE i.id=NEW.strategy_instance_id AND i.user_id=NEW.user_id)
    THEN RAISE EXCEPTION 'BROKER_CONNECTION_OWNER_MISMATCH';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS broker_connection_owner_check ON strategy_broker_connections;
CREATE TRIGGER broker_connection_owner_check BEFORE INSERT OR UPDATE ON strategy_broker_connections
FOR EACH ROW EXECUTE FUNCTION broker_connection_owner_guard();

-- Master Admin controls availability through the existing Feature Flags editor.
-- Disabled by default: an operator must explicitly enable this beta integration.
INSERT INTO feature_flags(key,enabled,config)
VALUES ('broker_trading212_readonly',false,'{"maxHistoryPages":10,"syncIntervalMinutes":60}'::jsonb)
ON CONFLICT(key) DO NOTHING;
