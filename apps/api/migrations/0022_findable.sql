-- "Kullanıcı adımla bulunabilirim" (docs/ADR/0023, QA Faz 9 slice 5a Y2): a privacy setting of
-- every account, on by default for 18+, always off for 15-17. Lookups by username follow this
-- setting alone, so that a name that is taken but not found says only "does not want to be found",
-- never the age band. Runs as bargu_owner.

ALTER TABLE app.users ADD COLUMN findable boolean NOT NULL DEFAULT true;
GRANT UPDATE (findable) ON app.users TO bargu_app;

-- 15-17 is never findable: kept so on every write, whoever writes it.
CREATE FUNCTION app.keep_minors_unfindable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NEW.age_band = '15-17' THEN
      NEW.findable := false;
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION app.keep_minors_unfindable() FROM PUBLIC;
CREATE TRIGGER users_minors_unfindable BEFORE INSERT OR UPDATE OF age_band, findable ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.keep_minors_unfindable();
UPDATE app.users SET findable = false WHERE age_band = '15-17';
ALTER TABLE app.users ADD CONSTRAINT users_minors_unfindable
  CHECK (age_band IS DISTINCT FROM '15-17' OR NOT findable);

-- Same as migration 0020, by the setting.
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
       AND findable
  $$;

-- Same as migration 0020, by the setting.
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
     WHERE username = p_username AND deleted_at IS NULL AND findable;
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

-- Same as migration 0020, by the setting.
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
     WHERE username = p_username AND deleted_at IS NULL AND findable;
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
