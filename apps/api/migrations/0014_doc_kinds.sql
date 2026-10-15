-- The server holds the rules of event documents itself (QA Faz 8 O4, docs/ADR/0020): it knows
-- which document is the meeting, a poll or a vote, and the poll of each vote; only an event's
-- admins set the meeting and run polls. The contents (time, place, options, choices) stay
-- encrypted. Before, only the phones held these rules: a member's modified app could change
-- someone else's poll, or file a vote under a poll that does not exist. Runs as bargu_owner.

CREATE TYPE app.doc_kind AS ENUM ('plan', 'poll', 'vote');

ALTER TABLE app.circle_docs ADD COLUMN kind app.doc_kind, ADD COLUMN poll_id uuid;
-- Documents saved before: the meeting is filed under the event's id, the other shared ones are
-- polls. A vote never said its poll: votes go (events last a week at most; people vote again).
UPDATE app.circle_docs
   SET kind = CASE WHEN id = circle_id THEN 'plan'::app.doc_kind
                   WHEN shared THEN 'poll'::app.doc_kind
                   ELSE 'vote'::app.doc_kind END;
DELETE FROM app.circle_docs WHERE kind = 'vote';
ALTER TABLE app.circle_docs
  ALTER COLUMN kind SET NOT NULL,
  -- One meeting per event, under the event's id; the meeting and polls are shared (among the
  -- admins), votes are their author's own and name their poll.
  ADD CONSTRAINT circle_docs_kind_shape CHECK (
    (kind = 'plan') = (id = circle_id)
    AND shared = (kind <> 'vote')
    AND (kind = 'vote') = (poll_id IS NOT NULL)
  ),
  -- A poll that goes takes its votes along.
  ADD CONSTRAINT circle_docs_poll FOREIGN KEY (circle_id, poll_id)
    REFERENCES app.circle_docs (circle_id, id) ON DELETE CASCADE;
CREATE INDEX circle_docs_poll ON app.circle_docs (circle_id, poll_id) WHERE poll_id IS NOT NULL;

-- Whether a document of an event is a poll (row-level security of the votes; it sees past the
-- caller's own rows, so it answers only this).
CREATE FUNCTION app.is_poll(p_circle uuid, p_doc uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.circle_docs WHERE circle_id = p_circle AND id = p_doc AND kind = 'poll'
    )
  $$;
REVOKE ALL ON FUNCTION app.is_poll(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_poll(uuid, uuid) TO bargu_app;

-- The meeting and polls are the event's admins' (its owners: they set the meeting, start and close
-- polls); every member votes, as themselves, only in a poll of that event (the project owner's
-- decision, 2026-10-15, docs/ADR/0020).
DROP POLICY circle_docs_add ON app.circle_docs;
CREATE POLICY circle_docs_add ON app.circle_docs FOR INSERT
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND author_id = app.current_user_id()
    AND app.event_end(circle_id) IS NOT NULL
    AND CASE kind
      WHEN 'vote' THEN app.is_poll(circle_id, poll_id)
      ELSE app.is_circle_owner(circle_id)
    END
  );
-- The meeting and polls the admins change (sealing them again for a new epoch too); a vote only
-- its author.
DROP POLICY circle_docs_change ON app.circle_docs;
CREATE POLICY circle_docs_change ON app.circle_docs FOR UPDATE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND CASE kind
      WHEN 'vote' THEN author_id = app.current_user_id()
      ELSE app.is_circle_owner(circle_id)
    END
  )
  WITH CHECK (app.is_active_member(circle_id, app.current_user_id()));
-- The admins delete the meeting and polls (a poll takes its votes along); a vote its author or an
-- admin.
DROP POLICY circle_docs_delete ON app.circle_docs;
CREATE POLICY circle_docs_delete ON app.circle_docs FOR DELETE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND (
      app.is_circle_owner(circle_id)
      OR (kind = 'vote' AND author_id = app.current_user_id())
    )
  );
