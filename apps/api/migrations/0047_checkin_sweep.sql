-- Arrival-check expiry deletes checks and their one-day setup tombstones in batches of 5000. The
-- worker repeats a full batch, so the result must describe both kinds: a full tombstone batch also
-- needs another call when no fired check happened to go. Runs as bargu_owner.

CREATE OR REPLACE FUNCTION app.expire_checkins() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed_checks integer;
    removed_setups integer;
  BEGIN
    DELETE FROM app.checkins
     WHERE ctid IN (
       SELECT ctid FROM app.checkins
        WHERE fired_at IS NOT NULL AND fired_at <= now() - interval '24 hours' LIMIT 5000
     );
    GET DIAGNOSTICS removed_checks = ROW_COUNT;
    DELETE FROM app.checkin_setups
     WHERE ctid IN (
       SELECT ctid FROM app.checkin_setups WHERE created_at <= now() - interval '24 hours' LIMIT 5000
     );
    GET DIAGNOSTICS removed_setups = ROW_COUNT;
    RETURN greatest(removed_checks, removed_setups);
  END
  $$;
