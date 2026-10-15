-- Event circles (BARGU_PLAN Faz 8, docs/ADR/0017): a circle with an end. A QR code or link lets
-- anyone holding it join until then; at the end the circle is deleted with everything in it
-- (members, keys, invites, places), and the API clears what it kept elsewhere (relay, streams,
-- queue). Runs as bargu_owner.

-- When an event circle ends; NULL for every other circle (and for circles the caller cannot see is
-- irrelevant: only the policies below use it, for circles the caller is an active member of).
CREATE FUNCTION app.event_end(p_circle uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT expires_at FROM app.circles WHERE id = p_circle AND kind = 'event' $$;

-- A new circle: groups have no end; an event has one, from a quarter of an hour to a week ahead.
DROP POLICY circles_create ON app.circles;
CREATE POLICY circles_create ON app.circles FOR INSERT
  WITH CHECK (
    created_by = app.current_user_id() AND kind <> 'pair' AND pair_key IS NULL AND epoch = 1
    AND (kind = 'event') = (expires_at IS NOT NULL)
    AND (expires_at IS NULL OR (expires_at >= now() + interval '14 minutes'
                                AND expires_at <= now() + interval '7 days 1 minute'))
  );

-- A new link: for an event circle, usable by up to 50 people until the event ends (one QR code at
-- the event); otherwise unchanged (single use, at most a day).
DROP POLICY invites_new ON app.invites;
CREATE POLICY invites_new ON app.invites AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    (circle_id IS NULL OR app.is_active_member(circle_id, app.current_user_id()))
    AND used_count = 0 AND revoked_at IS NULL
    AND CASE
      WHEN circle_id IS NOT NULL AND app.event_end(circle_id) IS NOT NULL
        THEN max_uses BETWEEN 1 AND 50 AND expires_at <= app.event_end(circle_id)
      ELSE max_uses = 1 AND expires_at <= now() + interval '1 day 1 minute'
    END
  );

-- Same as migration 0003, and an event circle that has ended takes nobody in (its links end with it
-- anyway; this also covers the moments before the sweep deletes it).
CREATE OR REPLACE FUNCTION app.redeem_invite(p_token_hash bytea) RETURNS uuid
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
      RETURN NULL;
    END IF;
    UPDATE app.invites SET used_count = used_count + 1
     WHERE token_hash = p_token_hash AND revoked_at IS NULL AND expires_at > now()
       AND used_count < max_uses AND created_by <> me
    RETURNING * INTO invite;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    IF invite.kind = 'circle' THEN
      PERFORM app.lock_circle(invite.circle_id::text);
      IF EXISTS (SELECT 1 FROM app.circles
                  WHERE id = invite.circle_id AND expires_at IS NOT NULL AND expires_at <= now()) THEN
        RETURN NULL;
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
      RETURN invite.circle_id;
    END IF;
    pair := least(me::text, invite.created_by::text) || ':' || greatest(me::text, invite.created_by::text);
    PERFORM app.lock_circle(pair);
    SELECT id INTO target FROM app.circles WHERE pair_key = pair;
    IF target IS NULL THEN
      INSERT INTO app.circles (kind, pair_key, created_by) VALUES ('pair', pair, invite.created_by)
      RETURNING id INTO target;
    ELSIF EXISTS (SELECT 1 FROM app.circle_members
                   WHERE circle_id = target AND ended_at > invite.created_at) THEN
      -- The friendship ended (or a request was declined) after this code was made: its "yes" no
      -- longer stands.
      RAISE EXCEPTION 'invite predates the end of the friendship' USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO app.circle_members (circle_id, user_id, role, status, invited_by, joined_at)
    VALUES (target, invite.created_by, 'owner', 'active', NULL, now()),
           (target, me, 'owner', 'active', invite.created_by, now())
    ON CONFLICT (circle_id, user_id) DO UPDATE
      SET status = 'active', joined_at = now(), ended_at = NULL;
    RETURN target;
  END
  $$;

-- The link preview also says when an event ends (the joiner sees it before joining).
DROP FUNCTION app.invite_preview(bytea);
CREATE FUNCTION app.invite_preview(p_token_hash bytea) RETURNS TABLE (
  kind app.invite_kind,
  inviter_username text,
  inviter_display_name text,
  inviter_avatar_color smallint,
  inviter_avatar_emoji text,
  circle_name text,
  circle_kind app.circle_kind,
  member_count integer,
  circle_expires_at timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT i.kind, u.username, u.display_name, u.avatar_color, u.avatar_emoji, c.name, c.kind,
           (SELECT count(*)::integer FROM app.circle_members m
             WHERE m.circle_id = c.id AND m.status = 'active'),
           c.expires_at
      FROM app.invites i
      JOIN app.users u ON u.id = i.created_by AND u.deleted_at IS NULL
      LEFT JOIN app.circles c ON c.id = i.circle_id
     WHERE i.token_hash = p_token_hash AND i.revoked_at IS NULL AND i.expires_at > now()
       AND i.used_count < i.max_uses AND app.current_user_id() IS NOT NULL
       AND (c.expires_at IS NULL OR c.expires_at > now())
  $$;

-- The owner ends an event now: it is deleted by the sweep below (which the API runs at once).
CREATE FUNCTION app.end_event(p_circle uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    UPDATE app.circles SET expires_at = now()
     WHERE id = p_circle AND kind = 'event' AND expires_at > now() AND app.is_circle_owner(p_circle);
    RETURN FOUND;
  END
  $$;

-- Deletes event circles that have ended (at most 100 per call; call again while it returns rows)
-- with everything that cascades from them: members, key distributions, invites, places. Returns
-- each circle and everyone who was ever in it, so the API can clear its other traces (relay
-- stores, event streams, queued notices) and tell their phones.
CREATE FUNCTION app.expire_event_circles() RETURNS TABLE (expired_id uuid, member_ids uuid[])
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    target uuid;
  BEGIN
    FOR target IN
      SELECT c.id FROM app.circles c
       WHERE c.kind = 'event' AND c.expires_at <= now()
       ORDER BY c.expires_at
       LIMIT 100
       FOR UPDATE SKIP LOCKED
    LOOP
      PERFORM app.lock_circle(target::text);
      expired_id := target;
      SELECT coalesce(array_agg(m.user_id), '{}') INTO member_ids
        FROM app.circle_members m WHERE m.circle_id = target;
      DELETE FROM app.circles WHERE id = target;
      RETURN NEXT;
    END LOOP;
  END
  $$;

REVOKE ALL ON FUNCTION app.event_end(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invite_preview(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.end_event(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.expire_event_circles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.event_end(uuid), app.invite_preview(bytea), app.end_event(uuid),
  app.expire_event_circles()
  TO bargu_app;
-- The end of an event changes only through app.end_event (owner) and the sweep: no column grant.
