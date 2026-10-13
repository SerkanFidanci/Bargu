-- Faz 4: circles, membership, invites and sender-key distributions (docs/ADR/0009).
-- Runs as bargu_owner (see src/db/migrate.ts). Row-level security is forced on every table; the few
-- cross-user operations go through narrow SECURITY DEFINER functions defined here.

CREATE TYPE app.circle_kind AS ENUM ('pair', 'friends', 'family', 'event');
CREATE TYPE app.member_role AS ENUM ('owner', 'member');
CREATE TYPE app.member_status AS ENUM ('invited', 'active', 'declined', 'left', 'removed');
CREATE TYPE app.invite_kind AS ENUM ('circle', 'friend');

CREATE TABLE app.circles (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind app.circle_kind NOT NULL,
  -- Plain text: an invitee sees it before holding any key. A pair (1:1 friendship) has no name.
  name text CHECK (char_length(name) BETWEEN 1 AND 40),
  -- One pair circle per two people: the two user ids, sorted, joined.
  pair_key text UNIQUE,
  -- Sender keys are per epoch; every membership or device change starts a new one (PROTOCOL §4).
  epoch integer NOT NULL DEFAULT 1 CHECK (epoch >= 1),
  epoch_started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'pair') = (name IS NULL)),
  CHECK ((kind = 'pair') = (pair_key IS NOT NULL))
);

CREATE TABLE app.circle_members (
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  role app.member_role NOT NULL DEFAULT 'member',
  status app.member_status NOT NULL,
  invited_by uuid REFERENCES app.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz,
  ended_at timestamptz,
  PRIMARY KEY (circle_id, user_id)
);
CREATE INDEX circle_members_user ON app.circle_members (user_id);

CREATE TABLE app.invites (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  kind app.invite_kind NOT NULL,
  -- A friend invite ("add me") makes a new pair circle when accepted, so it names no circle.
  circle_id uuid REFERENCES app.circles (id) ON DELETE CASCADE,
  -- SHA-256 of the token; the token itself exists only in the link / QR code.
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_by uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count BETWEEN 0 AND max_uses),
  revoked_at timestamptz,
  CHECK ((kind = 'friend') = (circle_id IS NULL))
);
CREATE INDEX invites_creator ON app.invites (created_by);

-- Signed sender-key distributions (PROTOCOL §4). The server checked the signature on upload and
-- cannot read them. Sender and recipient user ids are copied in so row-level security needs no join.
CREATE TABLE app.key_envelopes (
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  epoch integer NOT NULL CHECK (epoch >= 1),
  sender_device_id uuid NOT NULL REFERENCES app.devices (id) ON DELETE CASCADE,
  recipient_device_id uuid NOT NULL REFERENCES app.devices (id) ON DELETE CASCADE,
  sender_user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) <= 1024),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, epoch, sender_device_id, recipient_device_id)
);
CREATE INDEX key_envelopes_recipient ON app.key_envelopes (recipient_device_id, circle_id, epoch);

-- Membership helpers. SECURITY DEFINER (owner bypasses RLS): a policy on circle_members cannot
-- query circle_members itself without infinite recursion.
CREATE FUNCTION app.member_status_of(p_circle uuid, p_user uuid) RETURNS app.member_status
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT status FROM app.circle_members WHERE circle_id = p_circle AND user_id = p_user $$;

CREATE FUNCTION app.is_circle_member(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT coalesce(app.member_status_of(p_circle, app.current_user_id()) IN ('invited', 'active'), false)
  $$;

-- Answered only for circles the caller belongs to: outsiders learn nothing about who is in one.
CREATE FUNCTION app.is_active_member(p_circle uuid, p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT app.is_circle_member(p_circle)
       AND coalesce(app.member_status_of(p_circle, p_user) = 'active', false)
  $$;

CREATE FUNCTION app.is_circle_owner(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.circle_members
       WHERE circle_id = p_circle AND user_id = app.current_user_id()
         AND status = 'active' AND role = 'owner'
    )
  $$;

-- Only for the caller's own new circle (the first-member policy below).
CREATE FUNCTION app.circle_is_empty(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (SELECT 1 FROM app.circles WHERE id = p_circle AND created_by = app.current_user_id())
       AND NOT EXISTS (SELECT 1 FROM app.circle_members WHERE circle_id = p_circle)
  $$;

-- Serialises membership changes of one circle (or one pair of people) within a transaction, so
-- concurrent joins cannot exceed the size limit and concurrent leaves cannot orphan a group.
CREATE FUNCTION app.lock_circle(p_key text) RETURNS void
  LANGUAGE sql
  SET search_path = pg_catalog
  AS $$ SELECT pg_advisory_xact_lock(hashtextextended('circle:' || p_key, 0)) $$;

-- Sender keys suit circles of up to 50 people (BARGU_PLAN §1); invited people count too. Used only
-- inside the functions below, after app.lock_circle.
CREATE FUNCTION app.circle_has_room(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT count(*) < 50 FROM app.circle_members
     WHERE circle_id = p_circle AND status IN ('invited', 'active')
  $$;

-- Membership changes the runtime role may make directly: accept or decline an invitation to
-- yourself, leave a circle you are in; an owner may remove a member or make an active member owner.
-- Nothing else: a removed member cannot rejoin by updating their own row. Changes made inside the
-- SECURITY DEFINER functions below (invites, friend requests) run as the owner role and are checked
-- there instead.
CREATE FUNCTION app.check_member_transition() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
  BEGIN
    -- Exempt: the owner role only (migrations and the SECURITY DEFINER functions below, which
    -- check their own rules). Every other role, present or future, is held to these.
    IF current_user = 'bargu_owner' THEN
      RETURN NEW;
    END IF;
    IF NEW.circle_id <> OLD.circle_id OR NEW.user_id <> OLD.user_id
       OR NEW.invited_by IS DISTINCT FROM OLD.invited_by THEN
      RAISE EXCEPTION 'membership identity is immutable' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.role <> OLD.role AND NOT (
         OLD.role = 'member' AND NEW.role = 'owner' AND OLD.status = 'active'
         AND NEW.status = 'active' AND app.is_circle_owner(OLD.circle_id)) THEN
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
CREATE TRIGGER circle_members_transition BEFORE UPDATE ON app.circle_members
  FOR EACH ROW EXECUTE FUNCTION app.check_member_transition();

ALTER TABLE app.circles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.circles FORCE ROW LEVEL SECURITY;
CREATE POLICY circles_visible ON app.circles FOR SELECT
  USING (app.is_circle_member(id) OR created_by = app.current_user_id());
-- Groups only: pairs (friendships) exist solely through app.request_friend and app.redeem_invite,
-- and a new circle starts at epoch 1.
CREATE POLICY circles_create ON app.circles FOR INSERT
  WITH CHECK (
    created_by = app.current_user_id() AND kind <> 'pair' AND pair_key IS NULL
    AND epoch = 1 AND expires_at IS NULL
  );
CREATE POLICY circles_change ON app.circles FOR UPDATE
  USING (app.is_active_member(id, app.current_user_id()))
  WITH CHECK (app.is_active_member(id, app.current_user_id()));

ALTER TABLE app.circle_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.circle_members FORCE ROW LEVEL SECURITY;
CREATE POLICY members_visible ON app.circle_members FOR SELECT
  USING (user_id = app.current_user_id() OR app.is_circle_member(circle_id));
-- The only direct way in: the creator becomes the first (owner) member of a new circle. Inviting
-- someone (app.invite_user, app.request_friend) and joining by link (app.redeem_invite) go through
-- the functions below.
CREATE POLICY members_add ON app.circle_members FOR INSERT
  WITH CHECK (
    user_id = app.current_user_id() AND role = 'owner' AND status = 'active'
    AND invited_by IS NULL AND ended_at IS NULL
    AND app.circle_is_empty(circle_id)
    AND EXISTS (SELECT 1 FROM app.circles c
                 WHERE c.id = circle_id AND c.created_by = app.current_user_id()
                   AND c.kind <> 'pair')
  );
CREATE POLICY members_change ON app.circle_members FOR UPDATE
  USING (user_id = app.current_user_id() OR app.is_circle_owner(circle_id))
  WITH CHECK (user_id = app.current_user_id() OR app.is_circle_owner(circle_id));

ALTER TABLE app.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.invites FORCE ROW LEVEL SECURITY;
CREATE POLICY invites_own ON app.invites
  USING (created_by = app.current_user_id())
  WITH CHECK (created_by = app.current_user_id());
-- A new link: unused, single-use, at most a day, and for a circle only by an active member.
CREATE POLICY invites_new ON app.invites AS RESTRICTIVE FOR INSERT
  WITH CHECK (
    (circle_id IS NULL OR app.is_active_member(circle_id, app.current_user_id()))
    AND used_count = 0 AND max_uses = 1 AND revoked_at IS NULL
    AND expires_at <= now() + interval '1 day 1 minute'
  );

ALTER TABLE app.key_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.key_envelopes FORCE ROW LEVEL SECURITY;
CREATE POLICY envelopes_visible ON app.key_envelopes FOR SELECT
  USING (recipient_user_id = app.current_user_id() OR sender_user_id = app.current_user_id());
-- Only an active member may hand its sender key to another active member of the same circle.
CREATE POLICY envelopes_send ON app.key_envelopes FOR INSERT
  WITH CHECK (
    sender_user_id = app.current_user_id()
    AND app.is_active_member(circle_id, app.current_user_id())
    AND app.is_active_member(circle_id, recipient_user_id)
  );
CREATE POLICY envelopes_replace ON app.key_envelopes FOR UPDATE
  USING (sender_user_id = app.current_user_id())
  WITH CHECK (sender_user_id = app.current_user_id());

-- Redeeming an invite token: one atomic statement (two concurrent redemptions of a single-use
-- link cannot both succeed). For a circle invite the caller joins as an active member; a friend
-- invite creates the pair circle with both people active. Returns the circle, or nothing when the
-- token is unknown, expired, revoked or used up, or names the caller themselves.
CREATE FUNCTION app.redeem_invite(p_token_hash bytea) RETURNS uuid
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

-- Public card of every member of a circle the caller belongs to: profile and, for active members,
-- the active device's public key bundle (needed to hand out sender keys). Never the email hash.
-- Oldest membership first.
CREATE FUNCTION app.circle_member_cards(p_circle uuid) RETURNS TABLE (
  user_id uuid,
  role app.member_role,
  status app.member_status,
  username text,
  display_name text,
  avatar_color smallint,
  avatar_emoji text,
  device_id uuid,
  platform app.platform,
  identity_key bytea,
  dh_key bytea,
  dh_key_signature bytea
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT m.user_id, m.role, m.status, u.username, u.display_name, u.avatar_color, u.avatar_emoji,
           d.id, d.platform, d.identity_key, d.dh_key, d.dh_key_signature
      FROM app.circle_members m
      JOIN app.users u ON u.id = m.user_id AND u.deleted_at IS NULL
      LEFT JOIN app.devices d ON d.user_id = m.user_id AND d.revoked_at IS NULL AND m.status = 'active'
     WHERE m.circle_id = p_circle AND m.status IN ('invited', 'active')
       AND app.is_circle_member(p_circle)
       -- Someone only invited sees who invited them, not the other members, until they accept.
       AND (app.member_status_of(p_circle, app.current_user_id()) = 'active'
            OR m.user_id = app.current_user_id()
            OR m.user_id = (SELECT i.invited_by FROM app.circle_members i
                             WHERE i.circle_id = p_circle AND i.user_id = app.current_user_id()))
     ORDER BY m.created_at, m.user_id
  $$;

-- A user's public profile by username (adding a friend): no id, no email hash.
CREATE FUNCTION app.public_profile(p_username text) RETURNS TABLE (
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
  $$;

-- Moves a circle to a new sender-key epoch (PROTOCOL §4: membership or device change, 24 hours)
-- and drops distributions the protocol no longer accepts (older than N - 2). Only an active member
-- may, and only ever by one: the epoch cannot be rewound or pushed towards overflow.
CREATE FUNCTION app.start_epoch(p_circle uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_epoch integer;
  BEGIN
    IF NOT coalesce(app.member_status_of(p_circle, app.current_user_id()) = 'active', false) THEN
      RAISE EXCEPTION 'not an active member' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE app.circles SET epoch = epoch + 1, epoch_started_at = now()
     WHERE id = p_circle
    RETURNING epoch INTO v_epoch;
    DELETE FROM app.key_envelopes WHERE circle_id = p_circle AND epoch < v_epoch - 2;
    RETURN v_epoch;
  END
  $$;

-- Starts (or finds) the pair circle with the owner of a username. Returns the circle; NULL for an
-- unknown name or yourself. Asking someone who already asked you is saying yes to them; otherwise
-- they are asked, also after a decline or an unfriending: an earlier yes never carries over.
CREATE FUNCTION app.request_friend(p_username text) RETURNS uuid
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
    SELECT id INTO other FROM app.users WHERE username = p_username AND deleted_at IS NULL;
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

-- A friendship needs both people: once the caller left or declined a pair, it ends for the other
-- side too (a later request starts over and needs a new yes).
CREATE FUNCTION app.end_pair(p_circle uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    UPDATE app.circle_members m SET status = 'left', ended_at = now()
      FROM app.circles c
     WHERE c.id = p_circle AND c.kind = 'pair' AND m.circle_id = p_circle
       AND m.status IN ('invited', 'active')
       AND app.member_status_of(p_circle, app.current_user_id()) IN ('declined', 'left')
  $$;

-- Invites a user (by username) into a group circle the caller is active in, again after a decline
-- or a leave; not someone the owners removed. Returns false for unknown names, yourself, pairs,
-- full circles and people already in it.
CREATE FUNCTION app.invite_user(p_circle uuid, p_username text) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    other uuid;
  BEGIN
    PERFORM app.lock_circle(p_circle::text);
    IF me IS NULL OR NOT app.is_active_member(p_circle, me) OR NOT app.circle_has_room(p_circle)
       OR EXISTS (SELECT 1 FROM app.circles WHERE id = p_circle AND kind = 'pair') THEN
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

-- What a link holder sees before accepting: who invites, and to which circle (name, kind, size).
-- Nothing for unknown, expired, revoked or used-up tokens; no ids and no other members' identities.
CREATE FUNCTION app.invite_preview(p_token_hash bytea) RETURNS TABLE (
  kind app.invite_kind,
  inviter_username text,
  inviter_display_name text,
  inviter_avatar_color smallint,
  inviter_avatar_emoji text,
  circle_name text,
  circle_kind app.circle_kind,
  member_count integer
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT i.kind, u.username, u.display_name, u.avatar_color, u.avatar_emoji, c.name, c.kind,
           (SELECT count(*)::integer FROM app.circle_members m
             WHERE m.circle_id = c.id AND m.status = 'active')
      FROM app.invites i
      JOIN app.users u ON u.id = i.created_by AND u.deleted_at IS NULL
      LEFT JOIN app.circles c ON c.id = i.circle_id
     WHERE i.token_hash = p_token_hash AND i.revoked_at IS NULL AND i.expires_at > now()
       AND i.used_count < i.max_uses AND app.current_user_id() IS NOT NULL
  $$;

REVOKE ALL ON FUNCTION app.member_status_of(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_circle_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_active_member(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_circle_owner(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.circle_is_empty(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.check_member_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.redeem_invite(bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.circle_member_cards(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.public_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.request_friend(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.start_epoch(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.end_pair(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.lock_circle(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.circle_has_room(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invite_user(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.invite_preview(bytea) FROM PUBLIC;

-- app.circle_has_room and app.member_status_of stay internal to the functions above.
GRANT EXECUTE ON FUNCTION app.is_circle_member(uuid), app.is_active_member(uuid, uuid),
  app.is_circle_owner(uuid), app.circle_is_empty(uuid), app.lock_circle(text),
  app.redeem_invite(bytea), app.circle_member_cards(uuid), app.public_profile(text),
  app.request_friend(text), app.start_epoch(uuid), app.end_pair(uuid),
  app.invite_user(uuid, text), app.invite_preview(bytea)
  TO bargu_app;

-- The epoch changes only through app.start_epoch.
GRANT SELECT, INSERT, UPDATE (name) ON app.circles TO bargu_app;
GRANT SELECT, INSERT, UPDATE (role, status, joined_at, ended_at) ON app.circle_members TO bargu_app;
GRANT SELECT, INSERT, UPDATE (revoked_at) ON app.invites TO bargu_app;
GRANT SELECT, INSERT, UPDATE (envelope, created_at) ON app.key_envelopes TO bargu_app;
