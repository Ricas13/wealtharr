-- Plan presentation copy is administrator-owned and separate from entitlement enforcement.
-- Existing descriptions, prices, product mappings, and subscribed-plan history remain untouched.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS homepage_highlights jsonb NOT NULL DEFAULT '[]'::jsonb;

-- API validation limits these to five short strings; this check guards non-API writes as well.
ALTER TABLE plans
  ADD CONSTRAINT plans_homepage_highlights_array_check
  CHECK (jsonb_typeof(homepage_highlights) = 'array' AND jsonb_array_length(homepage_highlights) <= 5);
