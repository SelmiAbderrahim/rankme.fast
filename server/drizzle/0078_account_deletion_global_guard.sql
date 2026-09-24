-- Serialize the permanent account-tombstone handoff against every guarded
-- INSERT/UPDATE with one shared/exclusive transaction lock. The original
-- per-candidate locks can deadlock when a row carries multiple principals in
-- opposite orders, and they leave identity lookup -> write races outside the
-- guarded columns. All ordinary writes take the shared side before checking;
-- tombstone installation takes the exclusive side before inserting.
CREATE OR REPLACE FUNCTION reject_deleted_account_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  column_name text;
  candidate text;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(
    hashtext('rankme.fast:account-deletion-global:v1')
  );
  FOREACH column_name IN ARRAY TG_ARGV LOOP
    candidate := to_jsonb(NEW) ->> column_name;
    IF candidate IS NULL OR candidate = '' THEN
      CONTINUE;
    END IF;
    IF EXISTS (
      SELECT 1 FROM account_deletion_tombstones WHERE account_id = candidate
    ) THEN
      RAISE EXCEPTION 'account deletion has started for %', candidate
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
