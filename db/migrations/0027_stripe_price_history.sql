-- Stripe prices are immutable products. A new advertised amount creates a new Stripe
-- Price, but previously subscribed customers retain the original Price ID. Never delete
-- mappings when the plan's public price changes.
CREATE TABLE IF NOT EXISTS stripe_price_mappings (
  stripe_price_id text PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES plans(id),
  currency text NOT NULL,
  cadence text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS stripe_price_mappings_plan_idx ON stripe_price_mappings(plan_id);
CREATE TABLE IF NOT EXISTS stripe_plan_products (
  plan_id uuid PRIMARY KEY REFERENCES plans(id),
  stripe_product_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO stripe_price_mappings (stripe_price_id,plan_id,currency,cadence,amount_minor)
SELECT stripe_price_id,plan_id,currency,cadence,amount_minor
FROM plan_prices WHERE stripe_price_id IS NOT NULL
ON CONFLICT (stripe_price_id) DO NOTHING;
