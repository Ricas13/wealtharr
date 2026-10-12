-- Database integrity guards found in the independent review of main. Every statement is idempotent and
-- safe on a database that already holds data: constraints that existing rows might violate are added
-- NOT VALID (enforced for new writes) and validated in a block that only RAISEs NOTICE on legacy rows.

-- ---------------------------------------------------------------------------------------------
-- 1. Published (and retired) strategy versions are immutable.
--    Migration 0014 guarded only rows whose OLD status was PUBLISHED, did not protect the lifecycle
--    status itself and did not cover DELETE. A version could be retired and then have its rules edited,
--    or be moved back to DRAFT, edited and republished. Replace the function (the trigger keeps its name).
--    Maintenance tooling can still opt in explicitly with: SET app.allow_published_edit = 'on'.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION strategy_versions_guard_published() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.allow_published_edit', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF OLD.lifecycle_status IN ('PUBLISHED','RETIRED') THEN
    -- The only lifecycle move away from a released version is PUBLISHED -> RETIRED. RETIRED is terminal.
    IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
       AND NOT (OLD.lifecycle_status = 'PUBLISHED' AND NEW.lifecycle_status = 'RETIRED') THEN
      RAISE EXCEPTION 'STRATEGY_VERSION_LIFECYCLE_TRANSITION_REFUSED' USING ERRCODE = '23514';
    END IF;
    -- Rules, inputs, engine, dates of effect, disclosure and identity never change after release.
    -- effective_to, release_notes and upgrade_policy stay editable.
    IF NEW.config IS DISTINCT FROM OLD.config
       OR NEW.input_schema IS DISTINCT FROM OLD.input_schema
       OR NEW.engine_key IS DISTINCT FROM OLD.engine_key
       OR NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.disclosure IS DISTINCT FROM OLD.disclosure
       OR NEW.version IS DISTINCT FROM OLD.version
       OR NEW.strategy_definition_id IS DISTINCT FROM OLD.strategy_definition_id THEN
      RAISE EXCEPTION 'PUBLISHED_STRATEGY_VERSION_IS_IMMUTABLE' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- A released version that anything has used (instances, calculated state, actions, version migrations,
-- published track record, benchmarks) cannot be deleted. Unused throwaway rows stay deletable so test and
-- staging cleanup keeps working; the foreign keys already protect most references, this adds a clear
-- error and covers the ON DELETE CASCADE tables (track record, benchmarks).
CREATE OR REPLACE FUNCTION strategy_versions_guard_delete() RETURNS trigger AS $$
BEGIN
  IF coalesce(current_setting('app.allow_published_edit', true), '') = 'on' THEN
    RETURN OLD;
  END IF;
  IF OLD.lifecycle_status IN ('PUBLISHED','RETIRED') AND (
       EXISTS (SELECT 1 FROM strategy_instances WHERE strategy_version_id = OLD.id)
    OR EXISTS (SELECT 1 FROM strategy_states WHERE strategy_version_id = OLD.id)
    OR EXISTS (SELECT 1 FROM actions WHERE strategy_version_id = OLD.id)
    OR EXISTS (SELECT 1 FROM strategy_version_migrations WHERE from_version_id = OLD.id OR to_version_id = OLD.id)
    OR EXISTS (SELECT 1 FROM canonical_model_performance WHERE strategy_version_id = OLD.id)
    OR EXISTS (SELECT 1 FROM strategy_version_benchmarks WHERE strategy_version_id = OLD.id)
  ) THEN
    RAISE EXCEPTION 'PUBLISHED_STRATEGY_VERSION_CANNOT_BE_DELETED' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_versions_published_no_delete ON strategy_versions;
CREATE TRIGGER strategy_versions_published_no_delete
  BEFORE DELETE ON strategy_versions
  FOR EACH ROW EXECUTE FUNCTION strategy_versions_guard_delete();

-- ---------------------------------------------------------------------------------------------
-- 2. An admin who attested a version must remain deletable (account deletion). Keep who attested as
--    a text snapshot and let the user reference be cleared when the account is purged.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE strategy_version_attestations ADD COLUMN IF NOT EXISTS attested_by_email text;

UPDATE strategy_version_attestations a
SET attested_by_email = u.email
FROM users u
WHERE u.id = a.attested_by AND a.attested_by_email IS NULL;

ALTER TABLE strategy_version_attestations ALTER COLUMN attested_by DROP NOT NULL;

DO $$
DECLARE
  fk record;
  has_set_null boolean := false;
BEGIN
  FOR fk IN
    SELECT c.conname, c.confdeltype
    FROM pg_constraint c
    WHERE c.conrelid = 'strategy_version_attestations'::regclass
      AND c.contype = 'f'
      AND c.confrelid = 'users'::regclass
  LOOP
    IF fk.confdeltype = 'n' THEN
      has_set_null := true;
    ELSE
      EXECUTE format('ALTER TABLE strategy_version_attestations DROP CONSTRAINT %I', fk.conname);
    END IF;
  END LOOP;
  IF NOT has_set_null THEN
    ALTER TABLE strategy_version_attestations
      ADD CONSTRAINT strategy_version_attestations_attested_by_fkey
      FOREIGN KEY (attested_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Writers that only set attested_by (tests, repair scripts, older workers) still get the snapshot.
CREATE OR REPLACE FUNCTION strategy_version_attestations_snapshot_email() RETURNS trigger AS $$
BEGIN
  IF NEW.attested_by IS NOT NULL
     AND (NEW.attested_by_email IS NULL
          OR (TG_OP = 'UPDATE'
              AND NEW.attested_by IS DISTINCT FROM OLD.attested_by
              AND NEW.attested_by_email IS NOT DISTINCT FROM OLD.attested_by_email)) THEN
    SELECT email INTO NEW.attested_by_email FROM users WHERE id = NEW.attested_by;
  END IF;
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS strategy_version_attestations_snapshot_email ON strategy_version_attestations;
CREATE TRIGGER strategy_version_attestations_snapshot_email
  BEFORE INSERT OR UPDATE ON strategy_version_attestations
  FOR EACH ROW EXECUTE FUNCTION strategy_version_attestations_snapshot_email();

-- ---------------------------------------------------------------------------------------------
-- 3. Missing indexes and foreign keys on the ledger and action tables.
-- ---------------------------------------------------------------------------------------------
-- A ledger event can be reversed at most once (the correction route also checks this under a row lock).
-- If legacy data already holds duplicate corrections, fall back to a plain index and leave a notice so an
-- operator can de-duplicate by hand; the application check keeps new duplicates out either way.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'ledger_events_correction_unique') THEN
    BEGIN
      CREATE UNIQUE INDEX ledger_events_correction_unique
        ON ledger_events (correction_of_event_id) WHERE correction_of_event_id IS NOT NULL;
    EXCEPTION WHEN unique_violation THEN
      RAISE NOTICE 'ledger_events has duplicate corrections of one event; created a non-unique index instead. De-duplicate then re-create ledger_events_correction_unique manually.';
      CREATE INDEX IF NOT EXISTS ledger_events_correction_idx
        ON ledger_events (correction_of_event_id) WHERE correction_of_event_id IS NOT NULL;
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ledger_events_instrument_idx ON ledger_events (instrument_id);
CREATE INDEX IF NOT EXISTS actions_newest_idx ON actions (strategy_instance_id, calculated_at DESC, created_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_events_correction_of_event_fk' AND conrelid = 'ledger_events'::regclass) THEN
    ALTER TABLE ledger_events
      ADD CONSTRAINT ledger_events_correction_of_event_fk
      FOREIGN KEY (correction_of_event_id) REFERENCES ledger_events(id) NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_events_correction_of_event_fk' AND conrelid = 'ledger_events'::regclass AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE ledger_events VALIDATE CONSTRAINT ledger_events_correction_of_event_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'ledger_events.correction_of_event_id has orphaned legacy rows; constraint left NOT VALID (enforced for new rows).';
    END;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actions_superseded_by_action_fk' AND conrelid = 'actions'::regclass) THEN
    ALTER TABLE actions
      ADD CONSTRAINT actions_superseded_by_action_fk
      FOREIGN KEY (superseded_by_action_id) REFERENCES actions(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actions_superseded_by_action_fk' AND conrelid = 'actions'::regclass AND NOT convalidated) THEN
    BEGIN
      ALTER TABLE actions VALIDATE CONSTRAINT actions_superseded_by_action_fk;
    EXCEPTION WHEN foreign_key_violation THEN
      RAISE NOTICE 'actions.superseded_by_action_id has orphaned legacy rows; constraint left NOT VALID (enforced for new rows).';
    END;
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Case-insensitive email uniqueness. The application always compares lower(email); the database
--    only enforced exact-case uniqueness, so "A@x" and "a@x" could both register.
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE
  r record;
  duplicate_groups integer;
BEGIN
  FOR r IN SELECT id, email FROM users WHERE email <> lower(email) LOOP
    IF EXISTS (SELECT 1 FROM users o WHERE o.id <> r.id AND lower(o.email) = lower(r.email)) THEN
      RAISE NOTICE 'users % has a case-variant duplicate; email left unchanged', r.id;
    ELSE
      UPDATE users SET email = lower(email) WHERE id = r.id;
    END IF;
  END LOOP;

  SELECT count(*) INTO duplicate_groups
  FROM (SELECT lower(email) FROM users GROUP BY lower(email) HAVING count(*) > 1) d;

  IF duplicate_groups > 0 THEN
    RAISE NOTICE '% email address(es) exist in more than one letter case; users_email_lower_unique NOT created. Merge or rename them, then create it manually.', duplicate_groups;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_unique ON users (lower(email));
  END IF;
END $$;
