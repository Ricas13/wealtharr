-- Persist successful onboarding requests in the same transaction as the opening ledger.
-- Legacy clients remain compatible; browser retries supply a stable UUID.
CREATE TABLE IF NOT EXISTS strategy_creation_requests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  request_payload jsonb NOT NULL,
  strategy_instance_id uuid NOT NULL REFERENCES strategy_instances(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, request_key)
);
