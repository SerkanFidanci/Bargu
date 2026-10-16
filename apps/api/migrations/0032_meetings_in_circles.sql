-- A meeting in any circle (docs/ADR/0026): besides events, a pair, friends or family circle holds
-- one meeting (kind 'plan', under the circle's id; where and when stay encrypted). Any active
-- member starts it; only its starter (the document's author) and the circle's admins change or end
-- it; one at a time. It goes at `ends_at` (its time + 3 hours, said by the phone so the server can
-- delete it) or when ended. Event documents keep their rules. Runs as bargu_owner.

ALTER TABLE app.circle_docs
  ADD COLUMN ends_at timestamptz,
  -- Only a meeting outside an event says its end (an event's documents go with the event).
  ADD CONSTRAINT circle_docs_ends_at CHECK (ends_at IS NULL OR kind = 'plan');
CREATE INDEX circle_docs_ends_at ON app.circle_docs (ends_at) WHERE ends_at IS NOT NULL;
GRANT UPDATE (ends_at) ON app.circle_docs TO bargu_app;

-- Whether an end is one a meeting may have: ahead, within a week and a day.
CREATE FUNCTION app.meeting_end_ok(p_ends_at timestamptz) RETURNS boolean
  LANGUAGE sql STABLE
  SET search_path = pg_catalog
  AS $$ SELECT p_ends_at IS NOT NULL AND p_ends_at > now() AND p_ends_at <= now() + interval '8 days' $$;

-- Events as before (migration 0014); outside events only the meeting, by any active member, with
-- its end.
DROP POLICY circle_docs_add ON app.circle_docs;
CREATE POLICY circle_docs_add ON app.circle_docs FOR INSERT
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND author_id = app.current_user_id()
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN
        ends_at IS NULL
        AND CASE kind
          WHEN 'vote' THEN app.is_poll(circle_id, poll_id)
          ELSE app.is_circle_owner(circle_id)
        END
      ELSE kind = 'plan' AND app.meeting_end_ok(ends_at)
    END
  );
-- Outside events the meeting is its starter's and the admins' to change.
DROP POLICY circle_docs_change ON app.circle_docs;
CREATE POLICY circle_docs_change ON app.circle_docs FOR UPDATE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN
        CASE kind
          WHEN 'vote' THEN author_id = app.current_user_id()
          ELSE app.is_circle_owner(circle_id)
        END
      ELSE author_id = app.current_user_id() OR app.is_circle_owner(circle_id)
    END
  )
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN ends_at IS NULL
      ELSE app.meeting_end_ok(ends_at)
    END
  );
-- And to end.
DROP POLICY circle_docs_delete ON app.circle_docs;
CREATE POLICY circle_docs_delete ON app.circle_docs FOR DELETE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN
        app.is_circle_owner(circle_id)
        OR (kind = 'vote' AND author_id = app.current_user_id())
      ELSE author_id = app.current_user_id() OR app.is_circle_owner(circle_id)
    END
  );

-- For the worker: meetings past their end go, each with the members to tell. Nothing for a session.
CREATE FUNCTION app.expire_circle_meetings()
  RETURNS TABLE (circle_id uuid, members uuid[])
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF app.current_user_id() IS NOT NULL THEN
      RETURN;
    END IF;
    RETURN QUERY
      WITH gone AS (
        DELETE FROM app.circle_docs d
         WHERE d.kind = 'plan' AND d.ends_at IS NOT NULL AND d.ends_at <= now()
        RETURNING d.circle_id
      )
      SELECT g.circle_id,
             ARRAY(SELECT m.user_id FROM app.circle_members m
                    WHERE m.circle_id = g.circle_id AND m.status = 'active')
        FROM gone g;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_circle_meetings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_circle_meetings() TO bargu_app;
