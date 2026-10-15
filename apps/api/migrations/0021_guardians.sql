-- Guardians (docs/ADR/0023 §4): a parent (18+, with their own account) and a child (15-17), linked
-- in person by mutual approval. The child shows a one-time code (10 minutes), the parent takes it,
-- the child confirms. Nothing hidden: the child sees what the parent sees. No location through the
-- link. Runs as bargu_owner.

CREATE TABLE app.guardian_links (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  child_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  -- Null while the child's code waits for a parent.
  guardian_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  -- open: the code is out; confirming: a parent took it, the child has to say yes; active.
  status text NOT NULL CHECK (status IN ('open', 'confirming', 'active')),
  code_hash bytea UNIQUE,
  code_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  active_at timestamptz,
  -- The child asked to end it: it ends when the parent agrees, or 7 days later (md. 9/4).
  end_requested_at timestamptz,
  CHECK ((status = 'open') = (guardian_id IS NULL)),
  CHECK ((status = 'open') = (code_hash IS NOT NULL AND code_expires_at IS NOT NULL)),
  CHECK ((status = 'active') = (active_at IS NOT NULL)),
  CHECK (end_requested_at IS NULL OR status = 'active'),
  CHECK (guardian_id IS DISTINCT FROM child_id)
);
CREATE UNIQUE INDEX guardian_links_pair ON app.guardian_links (child_id, guardian_id)
  WHERE guardian_id IS NOT NULL;
CREATE INDEX guardian_links_guardian ON app.guardian_links (guardian_id)
  WHERE guardian_id IS NOT NULL;
CREATE INDEX guardian_links_child ON app.guardian_links (child_id);

-- Each side reads its own links; every change goes through the functions below.
ALTER TABLE app.guardian_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_links FORCE ROW LEVEL SECURITY;
CREATE POLICY guardian_links_parties ON app.guardian_links FOR SELECT
  USING (child_id = app.current_user_id() OR guardian_id = app.current_user_id());
GRANT SELECT ON app.guardian_links TO bargu_app;

-- At most two parents per child, those confirming included.
CREATE FUNCTION app.guardian_count(p_child uuid) RETURNS integer
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT count(*)::integer FROM app.guardian_links WHERE child_id = p_child AND status <> 'open'
  $$;
REVOKE ALL ON FUNCTION app.guardian_count(uuid) FROM PUBLIC;

-- The caller (15-17) shows a new code; an earlier open one goes.
CREATE FUNCTION app.open_guardian_code(p_code_hash bytea, p_expires_at timestamptz) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    link uuid;
  BEGIN
    IF me IS NULL OR NOT app.is_minor(me) THEN
      RAISE EXCEPTION 'only 15-17 adds a guardian' USING ERRCODE = 'insufficient_privilege';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('guardians:' || me::text, 0));
    IF app.guardian_count(me) >= 2 THEN
      RAISE EXCEPTION 'guardian limit' USING ERRCODE = 'check_violation';
    END IF;
    DELETE FROM app.guardian_links WHERE child_id = me AND status = 'open';
    INSERT INTO app.guardian_links (child_id, status, code_hash, code_expires_at)
    VALUES (me, 'open', p_code_hash, p_expires_at)
    RETURNING id INTO link;
    RETURN link;
  END
  $$;
REVOKE ALL ON FUNCTION app.open_guardian_code(bytea, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.open_guardian_code(bytea, timestamptz) TO bargu_app;

-- Whose code it is, before a parent says yes: the child's public card. Nothing for an unknown or
-- old code.
CREATE FUNCTION app.guardian_code_child(p_code_hash bytea) RETURNS TABLE (
  child_id uuid,
  username text,
  display_name text,
  avatar_color smallint,
  avatar_emoji text
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT u.id, u.username, u.display_name, u.avatar_color, u.avatar_emoji
      FROM app.guardian_links l
      JOIN app.users u ON u.id = l.child_id AND u.deleted_at IS NULL
     WHERE l.code_hash = p_code_hash AND l.status = 'open' AND l.code_expires_at > now()
       AND app.current_user_id() IS NOT NULL
  $$;
REVOKE ALL ON FUNCTION app.guardian_code_child(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_code_child(bytea) TO bargu_app;

-- The caller (18+) takes the child's code: the link waits for the child's yes. NULL for an unknown
-- or old code.
CREATE FUNCTION app.take_guardian_code(p_code_hash bytea) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    found_link app.guardian_links%ROWTYPE;
  BEGIN
    IF me IS NULL THEN
      RETURN NULL;
    END IF;
    IF (SELECT age_band FROM app.users WHERE id = me) IS DISTINCT FROM '18+' THEN
      RAISE EXCEPTION 'a guardian is 18+' USING ERRCODE = 'insufficient_privilege';
    END IF;
    SELECT * INTO found_link FROM app.guardian_links
     WHERE code_hash = p_code_hash AND status = 'open' AND code_expires_at > now();
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('guardians:' || found_link.child_id::text, 0));
    IF app.guardian_count(found_link.child_id) >= 2 THEN
      RAISE EXCEPTION 'guardian limit' USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM app.guardian_links
                WHERE child_id = found_link.child_id AND guardian_id = me) THEN
      RAISE EXCEPTION 'already a guardian' USING ERRCODE = 'check_violation';
    END IF;
    UPDATE app.guardian_links
       SET guardian_id = me, status = 'confirming', code_hash = NULL, code_expires_at = NULL
     WHERE id = found_link.id AND status = 'open';
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN found_link.id;
  END
  $$;
REVOKE ALL ON FUNCTION app.take_guardian_code(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.take_guardian_code(bytea) TO bargu_app;

-- The child's yes.
CREATE FUNCTION app.confirm_guardian(p_link uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    UPDATE app.guardian_links SET status = 'active', active_at = now()
     WHERE id = p_link AND child_id = app.current_user_id() AND status = 'confirming';
    RETURN FOUND;
  END
  $$;
REVOKE ALL ON FUNCTION app.confirm_guardian(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.confirm_guardian(uuid) TO bargu_app;

-- Ending a link: 'ended' at once (the parent, or one not yet active), 'requested' when the child
-- ends an active one (it ends when the parent agrees or 7 days later); NULL for someone else's.
CREATE FUNCTION app.end_guardian(p_link uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    found_link app.guardian_links%ROWTYPE;
  BEGIN
    SELECT * INTO found_link FROM app.guardian_links
     WHERE id = p_link AND (child_id = me OR guardian_id = me) AND status <> 'open'
       FOR UPDATE;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF found_link.guardian_id = me OR found_link.status <> 'active' THEN
      DELETE FROM app.guardian_links WHERE id = p_link;
      RETURN 'ended';
    END IF;
    UPDATE app.guardian_links SET end_requested_at = coalesce(end_requested_at, now())
     WHERE id = p_link;
    RETURN 'requested';
  END
  $$;
REVOKE ALL ON FUNCTION app.end_guardian(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.end_guardian(uuid) TO bargu_app;

-- The caller's links with the other side's public card (and id, for the server only).
CREATE FUNCTION app.my_guardian_links() RETURNS TABLE (
  id uuid,
  role text,
  status text,
  created_at timestamptz,
  active_at timestamptz,
  end_requested_at timestamptz,
  child_id uuid,
  other_id uuid,
  other_username text,
  other_display_name text,
  other_avatar_color smallint,
  other_avatar_emoji text
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT l.id, CASE WHEN l.child_id = app.current_user_id() THEN 'child' ELSE 'guardian' END,
           l.status, l.created_at, l.active_at, l.end_requested_at, l.child_id, u.id,
           u.username, u.display_name, u.avatar_color, u.avatar_emoji
      FROM app.guardian_links l
      JOIN app.users u
        ON u.id = CASE WHEN l.child_id = app.current_user_id() THEN l.guardian_id ELSE l.child_id END
     WHERE (l.child_id = app.current_user_id() OR l.guardian_id = app.current_user_id())
       AND l.status <> 'open'
     ORDER BY l.created_at, l.id
  $$;
REVOKE ALL ON FUNCTION app.my_guardian_links() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.my_guardian_links() TO bargu_app;

-- The worker: a child's request ends after 7 days, a code nobody took and a yes nobody gave go
-- after a day. Returns who was in them (to tell them).
CREATE FUNCTION app.expire_guardian_links() RETURNS TABLE (child_id uuid, guardian_id uuid)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.guardian_links l
     WHERE (l.status = 'active' AND l.end_requested_at < now() - interval '7 days')
        OR (l.status = 'open' AND l.code_expires_at < now() - interval '1 day')
        OR (l.status = 'confirming' AND l.created_at < now() - interval '1 day')
    RETURNING l.child_id, l.guardian_id
  $$;
REVOKE ALL ON FUNCTION app.expire_guardian_links() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_guardian_links() TO bargu_app;

-- No longer 15-17 (or no longer 18+ for a parent), or the account is being deleted: its links end.
CREATE FUNCTION app.end_guardian_links_of_user() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.age_band IS DISTINCT FROM '15-17' THEN
      DELETE FROM app.guardian_links WHERE child_id = NEW.id;
    END IF;
    IF NEW.deleted_at IS NOT NULL OR NEW.age_band IS DISTINCT FROM '18+' THEN
      DELETE FROM app.guardian_links WHERE guardian_id = NEW.id;
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION app.end_guardian_links_of_user() FROM PUBLIC;
CREATE TRIGGER users_guardian_links AFTER UPDATE OF age_band, deleted_at ON app.users
  FOR EACH ROW
  WHEN (OLD.age_band IS DISTINCT FROM NEW.age_band OR OLD.deleted_at IS DISTINCT FROM NEW.deleted_at)
  EXECUTE FUNCTION app.end_guardian_links_of_user();
