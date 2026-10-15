-- Location history (docs/ADR/0019): each member's trail in quarter hours, sealed for one circle
-- with a key only the members of that time hold. The server keeps it two weeks. It sees whose trail
-- it is, which quarter hours, and one of three sizes; never a position. Runs as bargu_owner.

CREATE TABLE app.history_chunks (
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  -- Start of the quarter hour (it is also inside the sealed trail, which phones check).
  slot timestamptz NOT NULL,
  -- HistoryEnvelope (packages/schemas envelope.ts): 512, 2048 or 8192 bytes of ciphertext.
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 12000),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, user_id, slot)
);
CREATE INDEX history_chunks_slot ON app.history_chunks (slot);
CREATE INDEX history_chunks_user ON app.history_chunks (user_id);

-- When the caller became an active member of a circle: they see history from then on only.
CREATE FUNCTION app.my_join(p_circle uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT joined_at FROM app.circle_members
     WHERE circle_id = p_circle AND user_id = app.current_user_id() AND status = 'active'
  $$;
REVOKE ALL ON FUNCTION app.my_join(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_join(uuid) TO bargu_app;

ALTER TABLE app.history_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.history_chunks FORCE ROW LEVEL SECURITY;
-- Active members read the circle's history from when they joined; nobody else sees it exists.
-- Their own pieces, members always read (a phone replacing one it sent).
CREATE POLICY history_read ON app.history_chunks FOR SELECT
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND (user_id = app.current_user_id() OR slot >= app.my_join(circle_id))
  );
-- A member writes, replaces and deletes only their own trail.
CREATE POLICY history_write ON app.history_chunks FOR INSERT
  WITH CHECK (
    user_id = app.current_user_id() AND app.is_active_member(circle_id, app.current_user_id())
  );
CREATE POLICY history_replace ON app.history_chunks FOR UPDATE
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id() AND app.is_active_member(circle_id, app.current_user_id())
  );
CREATE POLICY history_delete ON app.history_chunks FOR DELETE
  USING (user_id = app.current_user_id());

GRANT SELECT, INSERT, UPDATE (envelope, created_at), DELETE ON app.history_chunks TO bargu_app;

-- Whoever leaves a circle, or is removed from it, takes their trail in it along.
CREATE FUNCTION app.drop_departed_history() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF OLD.status = 'active' AND NEW.status IN ('left', 'removed') THEN
      DELETE FROM app.history_chunks WHERE circle_id = NEW.circle_id AND user_id = NEW.user_id;
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.drop_departed_history() FROM PUBLIC;
CREATE TRIGGER circle_members_departed_history AFTER UPDATE OF status ON app.circle_members
  FOR EACH ROW EXECUTE FUNCTION app.drop_departed_history();

-- Two weeks later every piece goes (the worker calls this; at most 5000 per call, again while it
-- returns that many).
CREATE FUNCTION app.expire_history() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.history_chunks
     WHERE ctid IN (
       SELECT ctid FROM app.history_chunks
        WHERE slot < now() - interval '14 days'
        LIMIT 5000
     );
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_history() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_history() TO bargu_app;
