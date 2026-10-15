-- One way in per person and code (QA Faz 8 O6): an event's QR code lets up to 50 people in, but each
-- of them only once. Leaving and coming back with the same code would start two new key epochs for
-- everyone each time; who left and wants back asks for a new code. Runs as bargu_owner.

-- Who came in with which code. No policy and no grant: only app.redeem_invite reaches it. It names
-- no circle; the codes, and with them these rows, go when their circle goes.
CREATE TABLE app.invite_uses (
  invite_id uuid NOT NULL REFERENCES app.invites (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  PRIMARY KEY (invite_id, user_id)
);
CREATE INDEX invite_uses_user ON app.invite_uses (user_id);
ALTER TABLE app.invite_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invite_uses FORCE ROW LEVEL SECURITY;

-- Same as migration 0008, and a circle code works once per person.
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
      -- After the membership check: someone still in hears "already a member", not this.
      INSERT INTO app.invite_uses (invite_id, user_id) VALUES (invite.id, me)
      ON CONFLICT DO NOTHING;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'code already used by this person' USING ERRCODE = 'check_violation';
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
