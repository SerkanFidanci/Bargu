-- Coming in with a code answers the same when asked again (QA Faz 9 slice 1, B2): a phone that
-- gave up waiting sends the request once more, but the first one may have gone through. The same
-- person with a code they already came in with, while still in, gets the same circle back and
-- nothing changes (no new epoch, no notice). Friend codes record who used them too.
-- Runs as bargu_owner.

DROP FUNCTION app.redeem_invite(bytea);
-- Same as migration 0013, and: answers (circle, fresh); no row for an unusable code.
CREATE FUNCTION app.redeem_invite(p_token_hash bytea)
  RETURNS TABLE (joined_circle uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    invite app.invites%ROWTYPE;
    target uuid;
    pair text;
  BEGIN
    IF me IS NULL THEN
      RETURN;
    END IF;
    -- Asked again: the code is one this person came in with, and they are still in.
    SELECT i.* INTO invite FROM app.invites i
      JOIN app.invite_uses u ON u.invite_id = i.id AND u.user_id = me
     WHERE i.token_hash = p_token_hash;
    IF FOUND THEN
      IF invite.kind = 'circle' THEN
        target := invite.circle_id;
      ELSE
        pair := least(me::text, invite.created_by::text) || ':' || greatest(me::text, invite.created_by::text);
        SELECT id INTO target FROM app.circles WHERE pair_key = pair;
      END IF;
      IF target IS NOT NULL AND coalesce(app.member_status_of(target, me) = 'active', false) THEN
        RETURN QUERY SELECT target, false;
        RETURN;
      END IF;
    END IF;
    UPDATE app.invites SET used_count = used_count + 1
     WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
       AND used_count < max_uses AND created_by <> me
    RETURNING * INTO invite;
    IF NOT FOUND THEN
      RETURN;
    END IF;
    IF invite.kind = 'circle' THEN
      PERFORM app.lock_circle(invite.circle_id::text);
      IF EXISTS (SELECT 1 FROM app.circles
                  WHERE id = invite.circle_id AND expires_at IS NOT NULL AND expires_at <= now()) THEN
        RETURN;
      END IF;
      IF NOT coalesce(app.member_status_of(invite.circle_id, invite.created_by) = 'active', false) THEN
        RAISE EXCEPTION 'inviter left the circle' USING ERRCODE = 'check_violation';
      END IF;
      IF NOT app.circle_has_room(invite.circle_id) THEN
        RAISE EXCEPTION 'circle is full' USING ERRCODE = 'check_violation';
      END IF;
      -- Coming back after leaving is as a member: a former owner does not get the role back.
      INSERT INTO app.circle_members (circle_id, user_id, role, status, invited_by, joined_at)
      VALUES (invite.circle_id, me, 'member', 'active', invite.created_by, now())
      ON CONFLICT (circle_id, user_id) DO UPDATE
        SET status = 'active', role = 'member', joined_at = now(), ended_at = NULL
        WHERE app.circle_members.status IN ('invited', 'declined', 'left');
      IF NOT FOUND THEN
        RAISE EXCEPTION 'already a member or removed' USING ERRCODE = 'check_violation';
      END IF;
      -- After the membership check: someone still in hears "already a member", not this.
      INSERT INTO app.invite_uses (invite_id, user_id) VALUES (invite.id, me)
      ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'code already used by this person' USING ERRCODE = 'check_violation';
      END IF;
      RETURN QUERY SELECT invite.circle_id, true;
      RETURN;
    END IF;
    pair := least(me::text, invite.created_by::text) || ':' || greatest(me::text, invite.created_by::text);
    PERFORM app.lock_circle(pair);
    SELECT id INTO target FROM app.circles WHERE pair_key = pair;
    IF target IS NULL THEN
      INSERT INTO app.circles (kind, pair_key, created_by) VALUES ('pair', pair, invite.created_by)
      RETURNING id INTO target;
    ELSIF EXISTS (SELECT 1 FROM app.circle_members m
                   WHERE m.circle_id = target AND m.ended_at > invite.created_at) THEN
      -- The friendship ended (or a request was declined) after this code was made: its "yes" no
      -- longer stands.
      RAISE EXCEPTION 'invite predates the end of the friendship' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO app.circle_members (circle_id, user_id, role, status, invited_by, joined_at)
    VALUES (target, invite.created_by, 'owner', 'active', NULL, now()),
           (target, me, 'owner', 'active', invite.created_by, now())
    ON CONFLICT (circle_id, user_id) DO UPDATE
      SET status = 'active', joined_at = now(), ended_at = NULL;
    INSERT INTO app.invite_uses (invite_id, user_id) VALUES (invite.id, me)
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT target, true;
  END
  $$;
REVOKE ALL ON FUNCTION app.redeem_invite(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.redeem_invite(bytea) TO bargu_app;
