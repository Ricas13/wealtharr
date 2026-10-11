-- An attestation covers a particular immutable set of reviewed strategy rules,
-- version dates, input fields, publication disclosures and release notes.
-- The API deletes stale approvals, but direct SQL, repair scripts and old workers
-- also need an independent database-side guard.
CREATE OR REPLACE FUNCTION invalidate_draft_strategy_attestation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.lifecycle_status='DRAFT' AND NEW.lifecycle_status='DRAFT'
     AND ROW(OLD.config, OLD.input_schema, OLD.engine_key, OLD.effective_from,
             OLD.effective_to, OLD.upgrade_policy, OLD.disclosure, OLD.release_notes)
         IS DISTINCT FROM
         ROW(NEW.config, NEW.input_schema, NEW.engine_key, NEW.effective_from,
             NEW.effective_to, NEW.upgrade_policy, NEW.disclosure, NEW.release_notes)
  THEN
    DELETE FROM strategy_version_attestations WHERE strategy_version_id=OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS invalidate_draft_strategy_attestation ON strategy_versions;
CREATE TRIGGER invalidate_draft_strategy_attestation
AFTER UPDATE ON strategy_versions
FOR EACH ROW EXECUTE FUNCTION invalidate_draft_strategy_attestation();
