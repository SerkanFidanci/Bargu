-- Ended event circles whose traces outside the database (Redis, event streams, the job queue) are
-- still to be cleared (docs/ADR/0017, QA Faz 8 Y1). The circle row goes in the same transaction
-- that records it here, so a clean-up cut short (Redis down, the worker restarting) is retried by
-- the next sweep until it went through; then this row goes too. Only the functions below touch it.
-- Runs as bargu_owner.

CREATE TABLE app.event_cleanups (
  -- No reference: the circle itself is already gone.
  circle_id uuid PRIMARY KEY,
  member_ids uuid[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.event_cleanups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.event_cleanups FORCE ROW LEVEL SECURITY;
-- No policy and no grant: the runtime role reaches it only through the functions below.

-- Same as migration 0008, and every deleted circle is recorded for its clean-up.
CREATE OR REPLACE FUNCTION app.expire_event_circles() RETURNS TABLE (expired_id uuid, member_ids uuid[])
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    target uuid;
  BEGIN
    FOR target IN
      SELECT c.id FROM app.circles c
       WHERE c.kind = 'event' AND c.expires_at <= now()
       ORDER BY c.expires_at
       LIMIT 100
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM app.lock_circle(target::text);
      expired_id := target;
      SELECT coalesce(array_agg(m.user_id), '{}') INTO member_ids
        FROM app.circle_members m WHERE m.circle_id = target;
      INSERT INTO app.event_cleanups (circle_id, member_ids) VALUES (target, member_ids)
        ON CONFLICT (circle_id) DO NOTHING;
      DELETE FROM app.circles WHERE id = target;
      RETURN NEXT;
    END LOOP;
  END
  $$;

-- Clean-ups still to do, oldest first (at most 100 per call).
CREATE FUNCTION app.pending_event_cleanups() RETURNS TABLE (circle_id uuid, member_ids uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT c.circle_id, c.member_ids FROM app.event_cleanups c ORDER BY c.created_at LIMIT 100
  $$;

-- A clean-up went through: its record goes too.
CREATE FUNCTION app.finish_event_cleanup(p_circle uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ DELETE FROM app.event_cleanups WHERE circle_id = p_circle $$;

REVOKE ALL ON FUNCTION app.pending_event_cleanups() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.finish_event_cleanup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.pending_event_cleanups(), app.finish_event_cleanup(uuid) TO bargu_app;
