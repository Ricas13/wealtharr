-- Closed vocabularies for text columns the application compares against literals. Each value list was
-- derived from every literal the code writes or compares (src, scripts, tests, db/migrations). Columns
-- whose vocabulary is owned by an external system (subscriptions.status mirrors Stripe/app-store states)
-- are intentionally NOT constrained: a new provider status must never make a webhook fail.
--
-- Each constraint is added NOT VALID (enforced for every new write, existing rows untouched) and then
-- validated; if legacy rows violate it the migration only RAISEs a NOTICE and leaves it NOT VALID, so it
-- can never fail a deployment.
-- ledger_events.event_type literal sources:
--   BUY, SELL                      trades route (zod side enum) and executeAction (action-service)
--   CONTRIBUTION                   contributions route, strategy creation, strategy switch
--   WITHDRAWAL, DIVIDEND, DISTRIBUTION, INTEREST, FEE, TAX   ledger-events route (zod enum)
--   OPENING_CASH, OPENING_POSITION opening-snapshot route and strategy switch
--   BROKER_ADJUSTMENT              reconcile route
--   CORRECTION                     ledger-events/[eventId]/correct route
--   SPLIT                          corporate-action split adjustment (fix-domain-correctness PR):
--                                  quantity-only, cash 0, ratio in metadata
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('users', 'users_role_vocabulary_check',
        'role IN (''USER'',''ADMIN'')'),
      ('strategy_instances', 'strategy_instances_status_vocabulary_check',
        'status IN (''ACTIVE'',''PAUSED'',''CLOSED'')'),
      ('actions', 'actions_status_vocabulary_check',
        'status IN (''CALCULATED'',''NOTIFIED'',''ACKNOWLEDGED'',''PARTIALLY_EXECUTED'',''EXECUTED'',''RECONCILED'',''CANCELLED'',''SUPERSEDED'')'),
      ('actions', 'actions_action_type_vocabulary_check',
        'action_type IN (''BUY'',''SELL'',''REBALANCE'',''HOLD'',''NO_ACTION'',''DATA_REQUIRED'')'),
      ('ledger_events', 'ledger_events_event_type_vocabulary_check',
        'event_type IN (''BUY'',''SELL'',''CONTRIBUTION'',''WITHDRAWAL'',''DIVIDEND'',''DISTRIBUTION'',''INTEREST'',''FEE'',''TAX'',''OPENING_CASH'',''OPENING_POSITION'',''BROKER_ADJUSTMENT'',''CORRECTION'',''SPLIT'')'),
      ('notification_deliveries', 'notification_deliveries_status_vocabulary_check',
        'status IN (''PENDING'',''SENDING'',''SENT'',''CANCELLED'',''DEAD_LETTER'')'),
      ('subscriptions', 'subscriptions_cadence_vocabulary_check',
        'cadence IN (''FREE'',''MONTHLY'',''ANNUAL'')'),
      ('strategy_versions', 'strategy_versions_lifecycle_vocabulary_check',
        'lifecycle_status IN (''DRAFT'',''PUBLISHED'',''RETIRED'')')
    ) AS t(tbl, conname, expr)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = c.conname AND conrelid = c.tbl::regclass
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (%s) NOT VALID', c.tbl, c.conname, c.expr);
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = c.conname AND conrelid = c.tbl::regclass AND NOT convalidated
    ) THEN
      BEGIN
        EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', c.tbl, c.conname);
      EXCEPTION WHEN check_violation THEN
        RAISE NOTICE 'Legacy rows violate %; constraint left NOT VALID (enforced for new writes only).', c.conname;
      END;
    END IF;
  END LOOP;
END $$;
