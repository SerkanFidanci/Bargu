-- Meeting answers outside events (docs/ADR/0026 Ek 2): "Geliyorum / Belki / Gelemiyorum" is a vote
-- document whose poll is the circle's meeting (its id is the circle's). The vote's own row-level
-- rules are those of an event's votes: written, changed and deleted by its author only. The
-- foreign key of migration 0014 (circle_docs_poll, ON DELETE CASCADE) takes the answers along when
-- the meeting is ended or swept.

-- Whether a document is the circle's meeting outside an event (the plan that names its end).
CREATE FUNCTION app.is_meeting(p_circle uuid, p_doc uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.circle_docs
      WHERE circle_id = p_circle AND id = p_doc AND kind = 'plan' AND ends_at IS NOT NULL
    )
  $$;
REVOKE ALL ON FUNCTION app.is_meeting(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_meeting(uuid, uuid) TO bargu_app;

-- Events as before; outside events the meeting with its end, or an answer to that meeting.
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
      ELSE
        (kind = 'plan' AND app.meeting_end_ok(ends_at))
        OR (kind = 'vote' AND ends_at IS NULL AND app.is_meeting(circle_id, poll_id))
    END
  );

-- An answer is only its author's to change, outside events as in them; the meeting as before
-- (its starter, the admins, either friend in a pair: migration 0036).
DROP POLICY circle_docs_change ON app.circle_docs;
CREATE POLICY circle_docs_change ON app.circle_docs FOR UPDATE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN kind = 'vote' THEN author_id = app.current_user_id()
      WHEN app.event_end(circle_id) IS NOT NULL THEN app.is_circle_owner(circle_id)
      ELSE author_id = app.current_user_id() OR app.is_circle_owner(circle_id)
        OR app.is_pair(circle_id)
    END
  )
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL OR kind = 'vote' THEN ends_at IS NULL
      ELSE app.meeting_end_ok(ends_at)
    END
  );

-- Deleting: as before (migration 0036); outside events an answer's author is already its deleter.
