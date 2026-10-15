-- Circle admins (docs/ADR/0020; the project owner's decision, 2026-10-15): the `owner` role is
-- shown as "Yönetici" (admin). A circle may have several; an admin makes a member admin and takes
-- it back from another admin, except from whoever created the circle. In an event only admins
-- invite (its QR code included); in a family or friends circle everyone does, as before.
-- Runs as bargu_owner.

-- Whether someone's admin role may be taken back: not in a pair, not from the circle's creator.
CREATE FUNCTION app.may_lose_admin(p_circle uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.circles
       WHERE id = p_circle AND kind <> 'pair' AND created_by IS DISTINCT FROM p_user
    )
  $$;
REVOKE ALL ON FUNCTION app.may_lose_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.may_lose_admin(uuid, uuid) TO bargu_app;

-- Same as migration 0003, and an admin may take the role back from another admin (not from the
-- circle's creator, and not in a pair, where both are owners for good).
CREATE OR REPLACE FUNCTION app.check_member_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
  BEGIN
    -- Exempt: the owner role only (migrations and the SECURITY DEFINER functions, which check
    -- their own rules). Every other role, present or future, is held to these.
    IF current_user = 'bargu_owner' THEN
      RETURN NEW;
    END IF;
    IF NEW.circle_id <> OLD.circle_id OR NEW.user_id <> OLD.user_id
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
      RAISE EXCEPTION 'membership identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.role <> OLD.role AND NOT (
         OLD.status = 'active' AND NEW.status = 'active' AND app.is_circle_owner(OLD.circle_id)
         AND (
           (OLD.role = 'member' AND NEW.role = 'owner')
           OR (OLD.role = 'owner' AND NEW.role = 'member' AND OLD.user_id <> me
               AND app.may_lose_admin(OLD.circle_id, OLD.user_id))
         )) THEN
      RAISE EXCEPTION 'role change not allowed' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = OLD.status THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'invited' AND NEW.status IN ('active', 'declined') AND OLD.user_id = me THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'active' AND NEW.status = 'left' AND OLD.user_id = me THEN
      RETURN NEW;
    END IF;
    IF OLD.status IN ('active', 'invited') AND NEW.status = 'removed' AND OLD.user_id <> me
       AND OLD.role <> 'owner' AND app.is_circle_owner(OLD.circle_id) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'membership transition % -> % not allowed', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END
  $$;

-- An event's links (its QR code) only by its admins.
CREATE POLICY invites_event_admins ON app.invites AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    circle_id IS NULL OR app.event_end(circle_id) IS NULL OR app.is_circle_owner(circle_id)
  );

-- Same as migration 0003, and into an event only its admins invite.
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
    SELECT id INTO other FROM app.users WHERE username = p_username AND deleted_at IS NULL;
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
