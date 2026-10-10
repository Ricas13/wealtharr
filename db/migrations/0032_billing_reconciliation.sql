ALTER TABLE subscriptions ADD COLUMN billing_checked_at timestamptz;
ALTER TABLE subscriptions ADD COLUMN billing_check_error text;
CREATE INDEX subscriptions_billing_reconciliation_idx
  ON subscriptions (billing_checked_at NULLS FIRST,user_id)
  WHERE source='STRIPE' AND stripe_subscription_id IS NOT NULL;
