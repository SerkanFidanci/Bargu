-- Documents of event circles (docs/ADR/0018): the meeting (when and where), polls on it, and the
-- votes in them, end-to-end encrypted. Each row is the signed, encrypted document of the member who
-- last saved it. The server sees how many documents an event has, who created each one, whether
-- other members may change it and when it changes; never a time, a place, an option or a vote.
-- Runs as bargu_owner.

CREATE TABLE app.circle_docs (
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  -- Chosen by the phone (it is also inside the encrypted document, which the phones check).
  id uuid NOT NULL,
  author_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  -- Shared documents (the meeting, a poll) every member may change; the others (a vote) only
  -- their author.
  shared boolean NOT NULL,
  -- DocEnvelope (packages/schemas envelope.ts): fixed-size ciphertext, about 1.6 kB.
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 3000),
  -- Grows with every save: phones replace a document only from the version they read.
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, id)
);
CREATE INDEX circle_docs_author ON app.circle_docs (author_id);

ALTER TABLE app.circle_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.circle_docs FORCE ROW LEVEL SECURITY;
-- Active members read their event's documents; nobody else sees that they exist.
CREATE POLICY circle_docs_read ON app.circle_docs FOR SELECT
  USING (app.is_active_member(circle_id, app.current_user_id()));
-- A member adds documents to an event (only events have them), as themselves.
CREATE POLICY circle_docs_add ON app.circle_docs FOR INSERT
  WITH CHECK (
    app.is_active_member(circle_id, app.current_user_id())
    AND author_id = app.current_user_id()
    AND app.event_end(circle_id) IS NOT NULL
  );
-- Shared documents every member changes; the others only their author.
CREATE POLICY circle_docs_change ON app.circle_docs FOR UPDATE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND (shared OR author_id = app.current_user_id())
  )
  WITH CHECK (app.is_active_member(circle_id, app.current_user_id()));
-- Their author deletes documents, and so does the event's owner.
CREATE POLICY circle_docs_delete ON app.circle_docs FOR DELETE
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND (author_id = app.current_user_id() OR app.is_circle_owner(circle_id))
  );

-- Author and sharing are fixed when a document is created.
GRANT SELECT, INSERT, UPDATE (envelope, version, updated_at), DELETE ON app.circle_docs TO bargu_app;

-- Whoever leaves an event, or is removed from it, takes their own documents (their votes) along;
-- shared ones stay with the event.
CREATE FUNCTION app.drop_departed_docs() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF OLD.status = 'active' AND NEW.status IN ('left', 'removed') THEN
      DELETE FROM app.circle_docs
       WHERE circle_id = NEW.circle_id AND author_id = NEW.user_id AND NOT shared;
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.drop_departed_docs() FROM PUBLIC;
CREATE TRIGGER circle_members_departed_docs AFTER UPDATE OF status ON app.circle_members
  FOR EACH ROW EXECUTE FUNCTION app.drop_departed_docs();
