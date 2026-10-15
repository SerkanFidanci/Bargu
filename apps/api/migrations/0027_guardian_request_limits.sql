-- Guardian requests within bounds (QA 5b/5c S-3 and the repeated notice): a child has at most 20
-- waiting, a newcomer at most 5 waiting across every child, and asking the same again tells nobody
-- again (the functions say which parents to tell only for a request new now). Runs as bargu_owner.

CREATE FUNCTION app.limit_guardian_requests() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    -- The same request again is no new one (the insert does nothing then).
    IF EXISTS (SELECT 1 FROM app.guardian_requests r
                WHERE r.child_id = NEW.child_id AND r.kind = NEW.kind
                  AND r.token_hash IS NOT DISTINCT FROM NEW.token_hash
                  AND r.username IS NOT DISTINCT FROM NEW.username
                  AND r.newcomer_id IS NOT DISTINCT FROM NEW.newcomer_id
                  AND r.circle_id IS NOT DISTINCT FROM NEW.circle_id) THEN
      RETURN NEW;
    END IF;
    IF (SELECT count(*) FROM app.guardian_requests WHERE child_id = NEW.child_id) >= 20
       OR (NEW.newcomer_id IS NOT NULL
           AND (SELECT count(*) FROM app.guardian_requests
                 WHERE newcomer_id = NEW.newcomer_id) >= 5) THEN
      RAISE EXCEPTION 'guardian requests full' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION app.limit_guardian_requests() FROM PUBLIC;
CREATE TRIGGER guardian_requests_limit BEFORE INSERT ON app.guardian_requests
  FOR EACH ROW EXECUTE FUNCTION app.limit_guardian_requests();

-- Same as migration 0023, and which parents to tell is said only for a request new now (fresh).
DROP FUNCTION app.ask_guardians_for_invite(bytea);
CREATE FUNCTION app.ask_guardians_for_invite(p_token_hash bytea)
  RETURNS TABLE (guardian_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    invite app.invites%ROWTYPE;
    added integer;
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
    GET DIAGNOSTICS added = ROW_COUNT;
    RETURN QUERY SELECT l.guardian_id, added > 0 FROM app.guardian_links l
                  WHERE l.child_id = me AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_invite(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_invite(bytea) TO bargu_app;

-- Same as migration 0023, with fresh.
DROP FUNCTION app.ask_guardians_for_friend(text);
CREATE FUNCTION app.ask_guardians_for_friend(p_username text)
  RETURNS TABLE (guardian_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
    added integer;
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
    GET DIAGNOSTICS added = ROW_COUNT;
    RETURN QUERY SELECT l.guardian_id, added > 0 FROM app.guardian_links l
                  WHERE l.child_id = me AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_friend(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_friend(text) TO bargu_app;

-- Same as migration 0024, with fresh.
DROP FUNCTION app.ask_guardians_to_admit(bytea);
CREATE FUNCTION app.ask_guardians_to_admit(p_token_hash bytea)
  RETURNS TABLE (guardian_id uuid, child_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    invite app.invites%ROWTYPE;
    added integer;
  BEGIN
    IF me IS NULL THEN
      RETURN;
    END IF;
    SELECT * INTO invite FROM app.invites
     WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
       AND used_count < max_uses AND created_by <> me;
    IF NOT FOUND OR NOT app.needs_guardian_yes(invite.created_by)
       OR app.is_guardian_of(invite.created_by) THEN
      RETURN;
    END IF;
    IF invite.kind = 'circle'
       AND (coalesce(app.member_status_of(invite.circle_id, me) = 'active', false)
            OR EXISTS (SELECT 1 FROM app.circles
                        WHERE id = invite.circle_id AND expires_at IS NOT NULL
                          AND expires_at <= now())) THEN
      RETURN;
    END IF;
    IF invite.kind = 'friend' AND app.are_friends(me, invite.created_by) THEN
      RETURN;
    END IF;
    INSERT INTO app.guardian_requests (child_id, kind, token_hash, newcomer_id)
    VALUES (invite.created_by, 'admit', p_token_hash, me)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    RETURN QUERY SELECT l.guardian_id, invite.created_by, added > 0 FROM app.guardian_links l
                  WHERE l.child_id = invite.created_by AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_to_admit(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_to_admit(bytea) TO bargu_app;

-- Same as migration 0024, with fresh.
DROP FUNCTION app.ask_guardians_for_member(uuid, text);
CREATE FUNCTION app.ask_guardians_for_member(p_circle uuid, p_username text)
  RETURNS TABLE (guardian_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
    added integer;
  BEGIN
    IF me IS NULL OR NOT app.needs_guardian_yes(me)
       OR NOT coalesce(app.member_status_of(p_circle, me) = 'active', false) THEN
      RETURN;
    END IF;
    SELECT id INTO other FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND findable;
    IF other IS NULL OR other = me
       OR app.member_status_of(p_circle, other) IN ('active', 'invited')
       OR EXISTS (SELECT 1 FROM app.guardian_links g
                   WHERE g.child_id = me AND g.guardian_id = other AND g.status = 'active') THEN
      RETURN;
    END IF;
    INSERT INTO app.guardian_requests (child_id, kind, username, circle_id)
    VALUES (me, 'member', p_username, p_circle)
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    RETURN QUERY SELECT l.guardian_id, added > 0 FROM app.guardian_links l
                  WHERE l.child_id = me AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_member(uuid, text) TO bargu_app;
