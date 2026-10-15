-- Ending events at scale (QA Faz 8 O1, D5, and the stale clean-up warning). Runs as bargu_owner.

-- The owner ends an event now: this circle alone goes, at once, recorded for its clean-up, and its
-- members (everyone ever in it) come back for that. The backlog of other ended events stays the
-- worker's: "end now" never waits for it. NULL when the caller cannot end it.
CREATE FUNCTION app.end_event_now(p_circle uuid) RETURNS uuid[]
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    members uuid[];
  BEGIN
    PERFORM app.lock_circle(p_circle::text);
    IF NOT EXISTS (SELECT 1 FROM app.circles
                    WHERE id = p_circle AND kind = 'event' AND expires_at > now())
       OR NOT app.is_circle_owner(p_circle) THEN
      RETURN NULL;
    END IF;
    SELECT coalesce(array_agg(m.user_id), '{}') INTO members
      FROM app.circle_members m WHERE m.circle_id = p_circle;
    INSERT INTO app.event_cleanups (circle_id, member_ids) VALUES (p_circle, members)
      ON CONFLICT (circle_id) DO NOTHING;
    DELETE FROM app.circles WHERE id = p_circle;
    RETURN members;
  END
  $$;
REVOKE ALL ON FUNCTION app.end_event_now(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.end_event_now(uuid) TO bargu_app;

-- How many clean-ups wait longer than they should (normally seconds): the worker warns about them.
CREATE FUNCTION app.stale_event_cleanups() RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT count(*)::integer FROM app.event_cleanups WHERE created_at < now() - interval '5 minutes'
  $$;
REVOKE ALL ON FUNCTION app.stale_event_cleanups() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.stale_event_cleanups() TO bargu_app;

-- Same as migration 0008, and only for a member (QA Faz 8 D5): an event's end is nobody else's.
CREATE OR REPLACE FUNCTION app.event_end(p_circle uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT expires_at FROM app.circles
     WHERE id = p_circle AND kind = 'event' AND app.is_circle_member(p_circle)
  $$;
