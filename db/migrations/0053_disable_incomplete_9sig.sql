-- A previously enabled/seeded partial 9Sig engine cannot be advertised as fully implemented.
-- This flag does not change published versions, subscriber instances, audit events or ledger history.
-- Its rules cannot be certified by the existing reduced value-target calculator.
UPDATE strategy_definitions SET enabled=false,updated_at=now()
  WHERE key='9sig' AND enabled=true;
