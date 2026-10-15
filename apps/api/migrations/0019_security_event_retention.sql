-- Security events are shown for 90 days (docs/ADR/0021) and kept no longer (QA Faz 9 slice 4, K5).
-- Runs as bargu_owner.

CREATE INDEX security_events_created ON app.security_events (created_at);

-- The worker calls this; at most 5000 per call, again while it returns that many.
CREATE FUNCTION app.expire_security_events() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.security_events
     WHERE ctid IN (
       SELECT ctid FROM app.security_events
        WHERE created_at < now() - interval '90 days'
        LIMIT 5000
     );
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_security_events() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_security_events() TO bargu_app;
