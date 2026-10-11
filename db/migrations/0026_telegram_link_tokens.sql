-- Single-use Telegram account link challenges; no plaintext tokens or chat IDs.
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS telegram_link_tokens_user_active_idx ON telegram_link_tokens(user_id,expires_at);
