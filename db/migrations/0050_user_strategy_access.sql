-- Individual access cannot bypass the global strategy release, subscription plan
-- permissions, or regional instrument market eligibility. Overrides are optional;
-- absent rows inherit the plan. Explicit DENY blocks new starts, switches and
-- resumed instances; existing immutable ledger history is never deleted.
CREATE TABLE IF NOT EXISTS user_strategy_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  strategy_definition_id uuid NOT NULL REFERENCES strategy_definitions(id) ON DELETE CASCADE,
  allowed boolean NOT NULL,
  set_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, strategy_definition_id)
);
CREATE INDEX IF NOT EXISTS user_strategy_access_definition_idx
 ON user_strategy_access(strategy_definition_id);
