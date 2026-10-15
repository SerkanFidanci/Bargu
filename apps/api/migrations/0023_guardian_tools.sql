-- Guardian tools (docs/ADR/0023 §5): what a parent sets for their 15-17 child, the requests waiting
-- for a parent's yes, and the minutes the app was open each day (last 7 days). All of it exists only
-- while the child has an active parent link, and goes with the last one. Runs as bargu_owner.

-- One set per child; either parent changes it (the last change counts), the child reads it.
CREATE TABLE app.guardian_settings (
  child_id uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  -- A friendship, a group or an event the child wants to join waits for a parent's yes.
  approve_new_people boolean NOT NULL DEFAULT true,
  -- The app closes for the day after this many minutes open (the location keeps going).
  daily_limit_minutes integer CHECK (daily_limit_minutes BETWEEN 30 AND 360),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app.users (id) ON DELETE SET NULL
);

-- A child's code or username waiting for a parent's yes: once, until a parent answers (7 days).
CREATE TABLE app.guardian_requests (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  child_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('invite', 'friend')),
  token_hash bytea,
  username text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'invite') = (token_hash IS NOT NULL)),
  CHECK ((kind = 'friend') = (username IS NOT NULL))
);
CREATE UNIQUE INDEX guardian_requests_code ON app.guardian_requests (child_id, token_hash)
  WHERE token_hash IS NOT NULL;
CREATE UNIQUE INDEX guardian_requests_name ON app.guardian_requests (child_id, username)
  WHERE username IS NOT NULL;

-- Minutes the app was open, per day as the child's phone counts it; the last 7 days only.
CREATE TABLE app.usage_days (
  child_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  day date NOT NULL,
  minutes integer NOT NULL CHECK (minutes BETWEEN 0 AND 1440),
  PRIMARY KEY (child_id, day)
);

-- Whether the caller is an active parent of this child.
CREATE FUNCTION app.is_guardian_of(p_child uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (SELECT 1 FROM app.guardian_links
                    WHERE child_id = p_child AND guardian_id = app.current_user_id()
                      AND status = 'active')
  $$;
REVOKE ALL ON FUNCTION app.is_guardian_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_guardian_of(uuid) TO bargu_app;

-- The child and their active parents read all of it; the functions below write it.
ALTER TABLE app.guardian_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY guardian_settings_read ON app.guardian_settings FOR SELECT
  USING (child_id = app.current_user_id() OR app.is_guardian_of(child_id));
GRANT SELECT ON app.guardian_settings TO bargu_app;
ALTER TABLE app.guardian_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.guardian_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY guardian_requests_read ON app.guardian_requests FOR SELECT
  USING (child_id = app.current_user_id() OR app.is_guardian_of(child_id));
GRANT SELECT ON app.guardian_requests TO bargu_app;
ALTER TABLE app.usage_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.usage_days FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_days_read ON app.usage_days FOR SELECT
  USING (child_id = app.current_user_id() OR app.is_guardian_of(child_id));
GRANT SELECT ON app.usage_days TO bargu_app;

-- Whether a new person for the caller waits for a parent's yes.
CREATE FUNCTION app.needs_guardian_yes(p_child uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT app.is_minor(p_child)
       AND EXISTS (SELECT 1 FROM app.guardian_links
                    WHERE child_id = p_child AND status = 'active')
       AND coalesce((SELECT approve_new_people FROM app.guardian_settings
                      WHERE child_id = p_child), true)
  $$;
REVOKE ALL ON FUNCTION app.needs_guardian_yes(uuid) FROM PUBLIC;

-- The parents to ask, when the caller's way in with this code waits for one; none otherwise (no
-- parent's yes needed, a code that does not work, or someone already in). Asking again is asking
-- the same.
CREATE FUNCTION app.ask_guardians_for_invite(p_token_hash bytea) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    invite app.invites%ROWTYPE;
  BEGIN
    -- No yes needed, or a way in a parent's yes would not open (an event without a friend's code).
    IF me IS NULL OR NOT app.needs_guardian_yes(me) OR NOT app.may_redeem(p_token_hash) THEN
      RETURN;
    END IF;
    SELECT * INTO invite FROM app.invites
     WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
       AND used_count < max_uses AND created_by <> me;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF invite.kind = 'circle'
       AND coalesce(app.member_status_of(invite.circle_id, me) = 'active', false) THEN
      RETURN;
    END IF;
    IF invite.kind = 'friend' AND app.are_friends(me, invite.created_by) THEN
      RETURN;
    END IF;
    INSERT INTO app.guardian_requests (child_id, kind, token_hash)
    VALUES (me, 'invite', p_token_hash)
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT guardian_id FROM app.guardian_links
                  WHERE child_id = me AND status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_invite(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_invite(bytea) TO bargu_app;

-- The same for a friend request by username (only to someone who can be found, and not a friend).
CREATE FUNCTION app.ask_guardians_for_friend(p_username text) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
  BEGIN
    IF me IS NULL OR NOT app.needs_guardian_yes(me) THEN
      RETURN;
    END IF;
    SELECT id INTO other FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND findable;
    IF other IS NULL OR other = me OR app.are_friends(me, other) THEN
      RETURN;
    END IF;
    INSERT INTO app.guardian_requests (child_id, kind, username)
    VALUES (me, 'friend', p_username)
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT guardian_id FROM app.guardian_links
                  WHERE child_id = me AND status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_friend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_friend(text) TO bargu_app;

-- What the waiting requests are, for the child and their parents: a friendship, a group or an
-- event, its name, who invited. A code that stopped working shows as such (null kind).
CREATE FUNCTION app.guardian_requests_of(p_child uuid) RETURNS TABLE (
  id uuid,
  kind text,
  circle_kind text,
  circle_name text,
  member_count integer,
  inviter_username text,
  inviter_display_name text,
  username text,
  created_at timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT r.id, r.kind, c.kind::text, c.name,
           CASE WHEN c.id IS NULL THEN NULL ELSE
             (SELECT count(*)::integer FROM app.circle_members m
               WHERE m.circle_id = c.id AND m.status = 'active') END,
           u.username, u.display_name, r.username, r.created_at
      FROM app.guardian_requests r
      LEFT JOIN app.invites i
        ON r.kind = 'invite' AND i.token_hash = r.token_hash AND i.revoked_at IS NULL
       AND i.expires_at > now() AND i.used_count < i.max_uses
      LEFT JOIN app.users u ON u.id = i.created_by AND u.deleted_at IS NULL
      LEFT JOIN app.circles c ON c.id = i.circle_id
     WHERE r.child_id = p_child
       AND (p_child = app.current_user_id() OR app.is_guardian_of(p_child))
     ORDER BY r.created_at, r.id
  $$;
REVOKE ALL ON FUNCTION app.guardian_requests_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_requests_of(uuid) TO bargu_app;

-- A parent takes a request off the list to answer it; returns what it was (the server then does
-- it as the child, or not). Nothing for someone else's.
CREATE FUNCTION app.take_guardian_request(p_request uuid) RETURNS TABLE (
  child_id uuid,
  kind text,
  token_hash bytea,
  username text
)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.guardian_requests r
     WHERE r.id = p_request AND app.is_guardian_of(r.child_id)
    RETURNING r.child_id, r.kind, r.token_hash, r.username
  $$;
REVOKE ALL ON FUNCTION app.take_guardian_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.take_guardian_request(uuid) TO bargu_app;

-- A parent sets the child's settings; returns false for someone not their parent.
CREATE FUNCTION app.set_guardian_settings(p_child uuid, p_approve boolean, p_limit integer)
  RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NOT app.is_guardian_of(p_child) THEN
      RETURN false;
    END IF;
    INSERT INTO app.guardian_settings (child_id, approve_new_people, daily_limit_minutes,
                                       updated_at, updated_by)
    VALUES (p_child, p_approve, p_limit, now(), app.current_user_id())
    ON CONFLICT (child_id) DO UPDATE
      SET approve_new_people = p_approve, daily_limit_minutes = p_limit, updated_at = now(),
          updated_by = app.current_user_id();
    RETURN true;
  END
  $$;
REVOKE ALL ON FUNCTION app.set_guardian_settings(uuid, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.set_guardian_settings(uuid, boolean, integer) TO bargu_app;

-- The child's phone writes the minutes of a day; kept only while a parent is linked. Returns the
-- parents (to tell them), none when nothing was kept.
CREATE FUNCTION app.record_usage(p_day date, p_minutes integer) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
  BEGIN
    IF me IS NULL OR NOT app.is_minor(me)
       OR NOT EXISTS (SELECT 1 FROM app.guardian_links WHERE child_id = me AND status = 'active')
       OR p_day < current_date - 7 OR p_day > current_date + 1 THEN
      RETURN;
    END IF;
    INSERT INTO app.usage_days (child_id, day, minutes) VALUES (me, p_day, p_minutes)
    ON CONFLICT (child_id, day) DO UPDATE SET minutes = p_minutes;
    RETURN QUERY SELECT guardian_id FROM app.guardian_links
                  WHERE child_id = me AND status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.record_usage(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.record_usage(date, integer) TO bargu_app;

-- Same as migration 0021, and a new link starts with the default settings (new people need a yes).
CREATE OR REPLACE FUNCTION app.confirm_guardian(p_link uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    UPDATE app.guardian_links SET status = 'active', active_at = now()
     WHERE id = p_link AND child_id = app.current_user_id() AND status = 'confirming';
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    INSERT INTO app.guardian_settings (child_id) VALUES (app.current_user_id())
    ON CONFLICT (child_id) DO NOTHING;
    RETURN true;
  END
  $$;

-- The last active link of a child ended: what the parents set and saw goes with it.
CREATE FUNCTION app.forget_guardian_tools() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.guardian_links
                    WHERE child_id = OLD.child_id AND status = 'active') THEN
      DELETE FROM app.guardian_settings WHERE child_id = OLD.child_id;
      DELETE FROM app.guardian_requests WHERE child_id = OLD.child_id;
      DELETE FROM app.usage_days WHERE child_id = OLD.child_id;
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.forget_guardian_tools() FROM PUBLIC;
CREATE TRIGGER guardian_links_forget_tools AFTER DELETE ON app.guardian_links
  FOR EACH ROW EXECUTE FUNCTION app.forget_guardian_tools();

-- The worker: requests nobody answered in 7 days, and minutes older than 7 days, go. Returns the
-- children whose requests went (to tell them and their parents).
CREATE FUNCTION app.expire_guardian_tools() RETURNS TABLE (child_id uuid)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    WITH old_minutes AS (
      DELETE FROM app.usage_days WHERE day < current_date - 7
    )
    DELETE FROM app.guardian_requests r WHERE r.created_at < now() - interval '7 days'
    RETURNING r.child_id
  $$;
REVOKE ALL ON FUNCTION app.expire_guardian_tools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_guardian_tools() TO bargu_app;

-- The child's settings with the username of the parent who changed them last, for the child and
-- their parents; the defaults when none were set.
CREATE FUNCTION app.guardian_settings_of(p_child uuid) RETURNS TABLE (
  approve_new_people boolean,
  daily_limit_minutes integer,
  updated_at timestamptz,
  updated_by text
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT s.approve_new_people, s.daily_limit_minutes, s.updated_at, u.username
      FROM app.guardian_settings s
      LEFT JOIN app.users u ON u.id = s.updated_by AND u.deleted_at IS NULL
     WHERE s.child_id = p_child
       AND (p_child = app.current_user_id() OR app.is_guardian_of(p_child))
  $$;
REVOKE ALL ON FUNCTION app.guardian_settings_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_settings_of(uuid) TO bargu_app;

-- Links made before this migration start with the defaults too.
INSERT INTO app.guardian_settings (child_id)
SELECT DISTINCT child_id FROM app.guardian_links WHERE status = 'active'
ON CONFLICT (child_id) DO NOTHING;
