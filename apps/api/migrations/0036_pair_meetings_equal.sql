-- In a friendship (pair) the two are equal (the PM's product decision, docs/ADR/0026 §1): either
-- one changes and ends the meeting, whoever started it. Before, only its starter and the circle's
-- admin (the friendship's maker) could: the other could not end one the maker started. Other
-- circles and events keep their rules (migration 0032). Runs as bargu_owner.
CREATE FUNCTION app.is_pair(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS (SELECT 1 FROM app.circles WHERE id = p_circle AND kind = 'pair') $$;
REVOKE ALL ON FUNCTION app.is_pair(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_pair(uuid) TO bargu_app;

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
        OR app.is_pair(circle_id)
    END
  )
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN ends_at IS NULL
      ELSE app.meeting_end_ok(ends_at)
    END
  );
DROP POLICY circle_docs_delete ON app.circle_docs;
CREATE POLICY circle_docs_delete ON app.circle_docs FOR DELETE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE
      WHEN app.event_end(circle_id) IS NOT NULL THEN
        app.is_circle_owner(circle_id)
        OR (kind = 'vote' AND author_id = app.current_user_id())
      ELSE author_id = app.current_user_id() OR app.is_circle_owner(circle_id)
        OR app.is_pair(circle_id)
    END
  );
