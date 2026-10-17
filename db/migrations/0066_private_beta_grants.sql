-- Complimentary invitation-only private beta access. No payment is recorded or implied.
-- One current grant per account; grants never change subscription source/status or historical ledgers.
CREATE TABLE IF NOT EXISTS private_beta_grants (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  CHECK (expires_at>granted_at),
  CHECK (revoked_at IS NULL OR revoked_at>=granted_at)
);
CREATE INDEX IF NOT EXISTS private_beta_grants_active_expiry_idx
  ON private_beta_grants(expires_at) WHERE revoked_at IS NULL;
