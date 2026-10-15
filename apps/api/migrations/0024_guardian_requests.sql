-- Guardian requests, both ways (docs/ADR/0023 §5, QA 5c F-2), and what a parent sees of other people
-- (QA 5b G-1). With "a yes for new people" on, a parent's yes is needed not only when the child
-- joins someone, but also when someone joins the child: through the child's own group or event
-- code, the child's friend code, or the child's invitation by username. A parent sees display names
-- only, never usernames, so that they cannot look anyone up. Runs as bargu_owner.

-- 'admit': someone (newcomer_id) came with the child's code; 'member': the child invites a username
-- into one of their circles.
ALTER TABLE app.guardian_requests
  ADD COLUMN newcomer_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  ADD COLUMN circle_id uuid REFERENCES app.circles (id) ON DELETE CASCADE,
  DROP CONSTRAINT guardian_requests_kind_check,
  DROP CONSTRAINT guardian_requests_check,
  DROP CONSTRAINT guardian_requests_check1,
  ADD CONSTRAINT guardian_requests_kind_check
    CHECK (kind IN ('invite', 'friend', 'admit', 'member')),
  ADD CONSTRAINT guardian_requests_code_check
    CHECK ((kind IN ('invite', 'admit')) = (token_hash IS NOT NULL)),
  ADD CONSTRAINT guardian_requests_name_check
    CHECK ((kind IN ('friend', 'member')) = (username IS NOT NULL)),
  ADD CONSTRAINT guardian_requests_newcomer_check CHECK ((kind = 'admit') = (newcomer_id IS NOT NULL)),
  ADD CONSTRAINT guardian_requests_circle_check CHECK ((kind = 'member') = (circle_id IS NOT NULL));
DROP INDEX app.guardian_requests_code;
DROP INDEX app.guardian_requests_name;
CREATE UNIQUE INDEX guardian_requests_code ON app.guardian_requests (child_id, token_hash)
  WHERE kind = 'invite';
CREATE UNIQUE INDEX guardian_requests_name ON app.guardian_requests (child_id, username)
  WHERE kind = 'friend';
CREATE UNIQUE INDEX guardian_requests_admit
  ON app.guardian_requests (child_id, token_hash, newcomer_id) WHERE kind = 'admit';
CREATE UNIQUE INDEX guardian_requests_member
  ON app.guardian_requests (child_id, circle_id, username) WHERE kind = 'member';

-- Someone comes with a code made by a child who needs a parent's yes for new people: the parents to
-- ask (and the child), none when no yes is needed (a code that does not work, someone already in,
-- or one of the child's own parents). Asking again is asking the same.
CREATE FUNCTION app.ask_guardians_to_admit(p_token_hash bytea)
  RETURNS TABLE (guardian_id uuid, child_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    invite app.invites%ROWTYPE;
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
    RETURN QUERY SELECT l.guardian_id, invite.created_by FROM app.guardian_links l
                  WHERE l.child_id = invite.created_by AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_to_admit(bytea) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_to_admit(bytea) TO bargu_app;

-- The child (caller) invites a username into one of their circles and needs a parent's yes: the
-- parents to ask, none otherwise (no yes needed, an unknown name, someone already in or invited, one
-- of the child's own parents).
CREATE FUNCTION app.ask_guardians_for_member(p_circle uuid, p_username text) RETURNS SETOF uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
  BEGIN
    IF me IS NULL OR NOT app.needs_guardian_yes(me)
       OR NOT coalesce(app.member_status_of(p_circle, me) = 'active', false) THEN
      RETURN;
    END IF;
    SELECT id INTO other FROM app.users
     WHERE username = p_username AND deleted_at IS NULL AND findable;
    IF other IS NULL OR other = me
       OR app.member_status_of(p_circle, other) IN ('active', 'invited')
       OR EXISTS (SELECT 1 FROM app.guardian_links
                   WHERE child_id = me AND guardian_id = other AND status = 'active') THEN
      RETURN;
    END IF;
    INSERT INTO app.guardian_requests (child_id, kind, username, circle_id)
    VALUES (me, 'member', p_username, p_circle)
    ON CONFLICT DO NOTHING;
    RETURN QUERY SELECT guardian_id FROM app.guardian_links
                  WHERE child_id = me AND status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_member(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_member(uuid, text) TO bargu_app;

-- Same as migration 0023, and the new kinds.
DROP FUNCTION app.take_guardian_request(uuid);
CREATE FUNCTION app.take_guardian_request(p_request uuid) RETURNS TABLE (
  child_id uuid,
  kind text,
  token_hash bytea,
  username text,
  newcomer_id uuid,
  circle_id uuid
)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.guardian_requests r
     WHERE r.id = p_request AND app.is_guardian_of(r.child_id)
    RETURNING r.child_id, r.kind, r.token_hash, r.username, r.newcomer_id, r.circle_id
  $$;
REVOKE ALL ON FUNCTION app.take_guardian_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.take_guardian_request(uuid) TO bargu_app;

-- What the waiting requests are, for the child and their parents, by display name only (QA 5b G-1).
DROP FUNCTION app.guardian_requests_of(uuid);
CREATE FUNCTION app.guardian_requests_of(p_child uuid) RETURNS TABLE (
  id uuid,
  kind text,
  circle_kind text,
  circle_name text,
  member_count integer,
  -- Whether the code still works (a gone one shows as such).
  code_works boolean,
  -- Who made the code (a request to join), who came with it (admit), or who is named (friend,
  -- member).
  inviter_display_name text,
  other_display_name text,
  created_at timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT r.id, r.kind, c.kind::text, c.name,
           CASE WHEN c.id IS NULL THEN NULL ELSE
             (SELECT count(*)::integer FROM app.circle_members m
               WHERE m.circle_id = c.id AND m.status = 'active') END,
           r.kind IN ('friend', 'member') OR (i.id IS NOT NULL AND u.id IS NOT NULL),
           u.display_name, o.display_name, r.created_at
      FROM app.guardian_requests r
      LEFT JOIN app.invites i
        ON r.kind IN ('invite', 'admit') AND i.token_hash = r.token_hash AND i.revoked_at IS NULL
       AND i.expires_at > now() AND i.used_count < i.max_uses
      LEFT JOIN app.users u ON u.id = i.created_by AND u.deleted_at IS NULL
      LEFT JOIN app.circles c ON c.id = coalesce(r.circle_id, i.circle_id)
      LEFT JOIN app.users o
        ON o.deleted_at IS NULL
       AND ((r.kind = 'admit' AND o.id = r.newcomer_id)
         OR (r.kind IN ('friend', 'member') AND o.username = r.username AND o.findable))
     WHERE r.child_id = p_child
       AND (p_child = app.current_user_id() OR app.is_guardian_of(p_child))
     ORDER BY r.created_at, r.id
  $$;
REVOKE ALL ON FUNCTION app.guardian_requests_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_requests_of(uuid) TO bargu_app;
