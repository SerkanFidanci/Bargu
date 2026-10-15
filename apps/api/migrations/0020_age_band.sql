-- The age band (docs/ADR/0023): 15-17 or 18+, as the person declared it (later: from the e-Devlet
-- age token). No birth date and no age are kept. Someone 15-17 is not found by username, gets no
-- location history and comes into an event only with a friend's code. Runs as bargu_owner.

ALTER TABLE app.users
  ADD COLUMN age_band text CHECK (age_band IN ('15-17', '18+')),
  ADD COLUMN age_method text CHECK (age_method IN ('declared', 'token')),
  ADD COLUMN age_set_at timestamptz,
  ADD CONSTRAINT users_age_complete CHECK (
    (age_band IS NULL) = (age_method IS NULL) AND (age_band IS NULL) = (age_set_at IS NULL)
  );
GRANT UPDATE (age_band, age_method, age_set_at) ON app.users TO bargu_app;

-- Whether someone is 15-17 (an account that never said counts as not: the app asks it at once).
CREATE FUNCTION app.is_minor(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT coalesce((SELECT age_band = '15-17' FROM app.users WHERE id = p_user), false)
  $$;
REVOKE ALL ON FUNCTION app.is_minor(uuid) FROM PUBLIC;

-- Whether two people are friends now: their pair circle, both of them in it.
CREATE FUNCTION app.are_friends(p_a uuid, p_b uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.circles c
       WHERE c.pair_key = least(p_a::text, p_b::text) || ':' || greatest(p_a::text, p_b::text)
         AND coalesce(app.member_status_of(c.id, p_a) = 'active', false)
         AND coalesce(app.member_status_of(c.id, p_b) = 'active', false)
    )
  $$;
REVOKE ALL ON FUNCTION app.are_friends(uuid, uuid) FROM PUBLIC;

-- Whether the caller may come in with this code: someone 15-17 joins an event only with the code of
-- a friend. True for everything else (an unknown code included: app.redeem_invite answers it), and
-- for someone already in (asking again).
CREATE FUNCTION app.may_redeem(p_token_hash bytea) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT NOT EXISTS (
      SELECT 1 FROM app.invites i
        JOIN app.circles c ON c.id = i.circle_id AND c.kind = 'event'
       WHERE i.token_hash = p_token_hash
         AND app.is_minor(app.current_user_id())
         AND NOT coalesce(app.member_status_of(c.id, app.current_user_id()) = 'active', false)
         AND NOT app.are_friends(app.current_user_id(), i.created_by)
    )
  $$;
REVOKE ALL ON FUNCTION app.may_redeem(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.may_redeem(bytea) TO bargu_app;

-- Same as migration 0003, and nobody 15-17 is found by username.
CREATE OR REPLACE FUNCTION app.public_profile(p_username text) RETURNS TABLE (
  username text,
  display_name text,
  avatar_color smallint,
  avatar_emoji text
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT username, display_name, avatar_color, avatar_emoji FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND app.current_user_id() IS NOT NULL
       AND age_band IS DISTINCT FROM '15-17'
  $$;

-- Same as migration 0003, and nobody 15-17 is asked by username (they ask, or use a code).
CREATE OR REPLACE FUNCTION app.request_friend(p_username text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
    pair text;
    target uuid;
    mine app.member_status;
    theirs app.member_status;
  BEGIN
    SELECT id INTO other FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND age_band IS DISTINCT FROM '15-17';
    IF me IS NULL OR other IS NULL OR other = me THEN
      RETURN NULL;
    END IF;
    pair := least(me::text, other::text) || ':' || greatest(me::text, other::text);
    PERFORM app.lock_circle(pair);
    SELECT id INTO target FROM app.circles WHERE pair_key = pair;
    IF target IS NULL THEN
      INSERT INTO app.circles (kind, pair_key, created_by) VALUES ('pair', pair, me)
      RETURNING id INTO target;
    END IF;
    mine := app.member_status_of(target, me);
    theirs := app.member_status_of(target, other);
    IF mine = 'active' AND theirs IN ('invited', 'active') THEN
      -- Already friends, or already asked: nothing changes.
      RETURN target;
    END IF;
    INSERT INTO app.circle_members (circle_id, user_id, role, status, joined_at)
    VALUES (target, me, 'owner', 'active', now())
    ON CONFLICT (circle_id, user_id) DO UPDATE SET status = 'active', joined_at = now(), ended_at = NULL;
    IF mine IS DISTINCT FROM 'invited' OR theirs IS DISTINCT FROM 'active' THEN
      INSERT INTO app.circle_members (circle_id, user_id, role, status, invited_by)
      VALUES (target, other, 'owner', 'invited', me)
      ON CONFLICT (circle_id, user_id) DO UPDATE
        SET status = 'invited', invited_by = me, joined_at = NULL, ended_at = NULL;
    END IF;
    PERFORM app.start_epoch(target);
    RETURN target;
  END
  $$;

-- Same as migration 0015, and nobody 15-17 is invited by username (a link or a code instead).
CREATE OR REPLACE FUNCTION app.invite_user(p_circle uuid, p_username text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
  BEGIN
    PERFORM app.lock_circle(p_circle::text);
    IF me IS NULL OR NOT app.is_active_member(p_circle, me) OR NOT app.circle_has_room(p_circle)
       OR EXISTS (SELECT 1 FROM app.circles WHERE id = p_circle AND kind = 'pair')
       OR (app.event_end(p_circle) IS NOT NULL AND NOT app.is_circle_owner(p_circle)) THEN
      RETURN false;
    END IF;
    SELECT id INTO other FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND age_band IS DISTINCT FROM '15-17';
    IF other IS NULL OR other = me THEN
      RETURN false;
    END IF;
    INSERT INTO app.circle_members (circle_id, user_id, role, status, invited_by)
    VALUES (p_circle, other, 'member', 'invited', me)
    ON CONFLICT (circle_id, user_id) DO UPDATE
      SET status = 'invited', role = 'member', invited_by = me, ended_at = NULL
      WHERE app.circle_members.status IN ('declined', 'left');
    RETURN FOUND;
  END
  $$;
