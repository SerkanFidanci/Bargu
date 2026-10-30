-- "Eve vardım kontrolü", the sealed escrow (docs/ADR/0039). The owner's phone leaves one sealed
-- alert per recipient's device and a time to open it; the server keeps them unread and hands them
-- over at that time unless the owner cancelled first. It knows that a check exists, whose, for whom,
-- when it opens and how big the boxes are; never where, how, or what the note says. A cancelled check
-- is deleted at once; a fired alert when its recipient has seen it, or a day later. Runs as
-- bargu_owner.

CREATE TABLE app.checkins (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  open_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  extends smallint NOT NULL DEFAULT 0,
  fired_at timestamptz,
  CHECK (open_at > created_at)
);
CREATE INDEX checkins_owner ON app.checkins (owner_id, created_at);
CREATE INDEX checkins_due ON app.checkins (open_at) WHERE fired_at IS NULL;
CREATE INDEX checkins_fired ON app.checkins (fired_at) WHERE fired_at IS NOT NULL;

CREATE TABLE app.checkin_boxes (
  checkin_id uuid NOT NULL REFERENCES app.checkins (id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  device_id uuid NOT NULL,
  box jsonb NOT NULL CHECK (octet_length(box::text) BETWEEN 100 AND 12000),
  PRIMARY KEY (checkin_id, recipient_id)
);
CREATE INDEX checkin_boxes_recipient ON app.checkin_boxes (recipient_id);

ALTER TABLE app.checkins ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkins FORCE ROW LEVEL SECURITY;
ALTER TABLE app.checkin_boxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkin_boxes FORCE ROW LEVEL SECURITY;

-- Whether a check has fired: SECURITY DEFINER, so the boxes' policy need not read app.checkins
-- under its own policy.
CREATE FUNCTION app.checkin_fired(p_checkin uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT coalesce((SELECT fired_at IS NOT NULL FROM app.checkins WHERE id = p_checkin), false) $$;
REVOKE ALL ON FUNCTION app.checkin_fired(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.checkin_fired(uuid) TO bargu_app;

-- The owner reads their checks; a recipient a fired check that still has their box. Nobody reads a
-- box before it fires, and then only its recipient. Written only through the functions below.
CREATE POLICY checkins_read ON app.checkins FOR SELECT
  USING (
    owner_id = app.current_user_id()
    OR (
      fired_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM app.checkin_boxes b
         WHERE b.checkin_id = id AND b.recipient_id = app.current_user_id()
      )
    )
  );
GRANT SELECT ON app.checkins TO bargu_app;
CREATE POLICY checkin_boxes_read ON app.checkin_boxes FOR SELECT
  USING (recipient_id = app.current_user_id() AND app.checkin_fired(checkin_id));
GRANT SELECT ON app.checkin_boxes TO bargu_app;

-- Whether p_recipient may get p_owner's alerts (ADR 0039 §8): another, live account, in a circle
-- with them now, and neither has blocked the other. One answer for every reason.
CREATE FUNCTION app.checkin_recipient_ok(p_owner uuid, p_recipient uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT p_recipient <> p_owner
      AND EXISTS (SELECT 1 FROM app.users WHERE id = p_recipient AND deleted_at IS NULL)
      AND EXISTS (
        SELECT 1 FROM app.circle_members a
          JOIN app.circle_members b ON b.circle_id = a.circle_id
         WHERE a.user_id = p_owner AND a.status = 'active'
           AND b.user_id = p_recipient AND b.status = 'active'
      )
      AND NOT EXISTS (
        SELECT 1 FROM app.blocks
         WHERE (blocker_id = p_owner AND blocked_id = p_recipient)
            OR (blocker_id = p_recipient AND blocked_id = p_owner)
      )
  $$;
REVOKE ALL ON FUNCTION app.checkin_recipient_ok(uuid, uuid) FROM PUBLIC;

-- Boxes as the phone sends them: [{ recipientId, box }], each box sealed to that recipient's
-- current device. 'ok' when every one is for a recipient who may get it, on their device, once.
CREATE FUNCTION app.checkin_boxes_ok(p_owner uuid, p_boxes jsonb, p_max integer) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_item jsonb;
    v_seen uuid[] := '{}';
    v_recipient uuid;
    v_device uuid;
  BEGIN
    IF jsonb_typeof(p_boxes) <> 'array' OR jsonb_array_length(p_boxes) NOT BETWEEN 1 AND p_max THEN
      RETURN false;
    END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_boxes) LOOP
      v_recipient := (v_item ->> 'recipientId')::uuid;
      v_device := (v_item -> 'box' ->> 'recipientDeviceId')::uuid;
      IF v_recipient = ANY (v_seen) OR NOT app.checkin_recipient_ok(p_owner, v_recipient) THEN
        RETURN false;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM app.devices
         WHERE id = v_device AND user_id = v_recipient AND revoked_at IS NULL
      ) THEN
        RETURN false;
      END IF;
      v_seen := v_seen || v_recipient;
    END LOOP;
    RETURN true;
  END
  $$;
REVOKE ALL ON FUNCTION app.checkin_boxes_ok(uuid, jsonb, integer) FROM PUBLIC;

CREATE FUNCTION app.put_checkin_boxes(p_checkin uuid, p_boxes jsonb) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.checkin_boxes WHERE checkin_id = p_checkin;
    INSERT INTO app.checkin_boxes (checkin_id, recipient_id, device_id, box)
    SELECT p_checkin, (item ->> 'recipientId')::uuid, (item -> 'box' ->> 'recipientDeviceId')::uuid,
           item -> 'box'
      FROM jsonb_array_elements(p_boxes) AS item;
  $$;
REVOKE ALL ON FUNCTION app.put_checkin_boxes(uuid, jsonb) FROM PUBLIC;

-- Sets a check for the caller. Asking again with the same id (a lost answer) is 'ok' and changes
-- nothing. Returns 'ok' or why not.
CREATE FUNCTION app.create_checkin(
  p_id uuid,
  p_open_at timestamptz,
  p_min interval,
  p_max interval,
  p_max_active integer,
  p_per_day integer,
  p_max_recipients integer,
  p_boxes jsonb
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_me uuid := app.current_user_id();
  BEGIN
    IF v_me IS NULL THEN RETURN 'INVALID'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended('checkin:' || v_me::text, 0));
    IF EXISTS (SELECT 1 FROM app.checkins WHERE id = p_id) THEN
      RETURN CASE WHEN EXISTS (SELECT 1 FROM app.checkins WHERE id = p_id AND owner_id = v_me)
                  THEN 'ok' ELSE 'INVALID' END;
    END IF;
    IF p_open_at < now() + p_min OR p_open_at > now() + p_max THEN RETURN 'TIME'; END IF;
    IF (SELECT count(*) FROM app.checkins WHERE owner_id = v_me AND fired_at IS NULL)
       >= p_max_active THEN
      RETURN 'TOO_MANY';
    END IF;
    IF (SELECT count(*) FROM app.checkins
         WHERE owner_id = v_me AND created_at > now() - interval '24 hours') >= p_per_day THEN
      RETURN 'DAILY_LIMIT';
    END IF;
    IF NOT app.checkin_boxes_ok(v_me, p_boxes, p_max_recipients) THEN RETURN 'RECIPIENT'; END IF;
    INSERT INTO app.checkins (id, owner_id, open_at) VALUES (p_id, v_me, p_open_at);
    PERFORM app.put_checkin_boxes(p_id, p_boxes);
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.create_checkin(uuid, timestamptz, interval, interval, integer, integer,
  integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_checkin(uuid, timestamptz, interval, interval, integer, integer,
  integer, jsonb) TO bargu_app;

-- On the way: the same recipients' boxes again, at most once per p_gap. The time never moves here.
CREATE FUNCTION app.refresh_checkin(p_id uuid, p_gap interval, p_max_recipients integer, p_boxes jsonb)
  RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_me uuid := app.current_user_id();
    v_check app.checkins%ROWTYPE;
  BEGIN
    SELECT * INTO v_check FROM app.checkins WHERE id = p_id AND owner_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF v_check.fired_at IS NOT NULL THEN RETURN 'FIRED'; END IF;
    IF v_check.updated_at > now() - p_gap THEN RETURN 'RATE_LIMITED'; END IF;
    -- The same people as when it was set.
    IF (SELECT array_agg(recipient_id ORDER BY recipient_id) FROM app.checkin_boxes
         WHERE checkin_id = p_id)
       IS DISTINCT FROM
       (SELECT array_agg((item ->> 'recipientId')::uuid ORDER BY (item ->> 'recipientId')::uuid)
          FROM jsonb_array_elements(p_boxes) AS item) THEN
      RETURN 'RECIPIENT';
    END IF;
    IF NOT app.checkin_boxes_ok(v_me, p_boxes, p_max_recipients) THEN RETURN 'RECIPIENT'; END IF;
    PERFORM app.put_checkin_boxes(p_id, p_boxes);
    UPDATE app.checkins SET updated_at = now() WHERE id = p_id;
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.refresh_checkin(uuid, interval, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.refresh_checkin(uuid, interval, integer, jsonb) TO bargu_app;

-- Only the owner moves the time: later than before, at most p_max after it was set, p_max_extends
-- times, with boxes sealed again for the new due time.
CREATE FUNCTION app.extend_checkin(
  p_id uuid,
  p_open_at timestamptz,
  p_max interval,
  p_max_extends integer,
  p_max_recipients integer,
  p_boxes jsonb
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_me uuid := app.current_user_id();
    v_check app.checkins%ROWTYPE;
  BEGIN
    SELECT * INTO v_check FROM app.checkins WHERE id = p_id AND owner_id = v_me FOR UPDATE;
    IF NOT FOUND THEN RETURN 'NOT_FOUND'; END IF;
    IF v_check.fired_at IS NOT NULL THEN RETURN 'FIRED'; END IF;
    IF v_check.extends >= p_max_extends THEN RETURN 'EXTENDS'; END IF;
    IF p_open_at <= v_check.open_at OR p_open_at > v_check.created_at + p_max THEN RETURN 'TIME'; END IF;
    IF (SELECT array_agg(recipient_id ORDER BY recipient_id) FROM app.checkin_boxes
         WHERE checkin_id = p_id)
       IS DISTINCT FROM
       (SELECT array_agg((item ->> 'recipientId')::uuid ORDER BY (item ->> 'recipientId')::uuid)
          FROM jsonb_array_elements(p_boxes) AS item) THEN
      RETURN 'RECIPIENT';
    END IF;
    IF NOT app.checkin_boxes_ok(v_me, p_boxes, p_max_recipients) THEN RETURN 'RECIPIENT'; END IF;
    PERFORM app.put_checkin_boxes(p_id, p_boxes);
    UPDATE app.checkins
       SET open_at = p_open_at, extends = extends + 1, updated_at = now()
     WHERE id = p_id;
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.extend_checkin(uuid, timestamptz, interval, integer, integer, jsonb)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.extend_checkin(uuid, timestamptz, interval, integer, integer, jsonb)
  TO bargu_app;

-- Who a check's alerts are for, to its owner alone (the boxes are the recipients' to read).
CREATE FUNCTION app.checkin_recipients(p_id uuid) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $
    SELECT b.recipient_id FROM app.checkin_boxes b
      JOIN app.checkins c ON c.id = b.checkin_id
     WHERE b.checkin_id = p_id AND c.owner_id = app.current_user_id()
     ORDER BY b.recipient_id
  $;
REVOKE ALL ON FUNCTION app.checkin_recipients(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.checkin_recipients(uuid) TO bargu_app;

-- Arrived or "İyiyim": a check that has not fired goes at once, for good. One that fired stays for
-- its recipients ('FIRED'); a check that is not there is 'ok' (asked twice).
CREATE FUNCTION app.cancel_checkin(p_id uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    DELETE FROM app.checkins
     WHERE id = p_id AND owner_id = app.current_user_id() AND fired_at IS NULL;
    IF FOUND THEN RETURN 'ok'; END IF;
    IF EXISTS (SELECT 1 FROM app.checkins WHERE id = p_id AND owner_id = app.current_user_id()) THEN
      RETURN 'FIRED';
    END IF;
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.cancel_checkin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.cancel_checkin(uuid) TO bargu_app;

-- "Gördüm": the caller's own box of a fired check goes; the check goes with its last box.
CREATE FUNCTION app.ack_checkin(p_id uuid) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    DELETE FROM app.checkin_boxes
     WHERE checkin_id = p_id AND recipient_id = app.current_user_id()
       AND app.checkin_fired(p_id);
    DELETE FROM app.checkins c
     WHERE c.id = p_id AND c.fired_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM app.checkin_boxes b WHERE b.checkin_id = c.id);
  END
  $$;
REVOKE ALL ON FUNCTION app.ack_checkin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ack_checkin(uuid) TO bargu_app;

-- The worker fires a check at its time (no user: app.user_id unset). Boxes of recipients who may no
-- longer get it go first, unseen. Returns the owner and who to tell, or nothing when there is
-- nothing to fire (cancelled, fired already, or not yet its time).
CREATE FUNCTION app.fire_checkin(p_id uuid)
  RETURNS TABLE (owner_id uuid, recipient_id uuid, device_id uuid)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_check app.checkins%ROWTYPE;
  BEGIN
    IF app.current_user_id() IS NOT NULL THEN RETURN; END IF;
    SELECT * INTO v_check FROM app.checkins c WHERE c.id = p_id FOR UPDATE;
    IF NOT FOUND OR v_check.fired_at IS NOT NULL OR v_check.open_at > now() THEN RETURN; END IF;
    DELETE FROM app.checkin_boxes b
     WHERE b.checkin_id = p_id AND NOT app.checkin_recipient_ok(v_check.owner_id, b.recipient_id);
    UPDATE app.checkins c SET fired_at = now() WHERE c.id = p_id;
    -- One row at least, so the owner hears it fired even when no recipient is left.
    RETURN QUERY
      SELECT v_check.owner_id, b.recipient_id, b.device_id
        FROM (SELECT 1) AS one
        LEFT JOIN app.checkin_boxes b ON b.checkin_id = p_id;
  END
  $$;
REVOKE ALL ON FUNCTION app.fire_checkin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.fire_checkin(uuid) TO bargu_app;

-- Checks past their time that no job fired (the worker was down): for the worker to fire now.
CREATE FUNCTION app.overdue_checkins() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT id FROM app.checkins
     WHERE app.current_user_id() IS NULL AND fired_at IS NULL AND open_at <= now() - interval '1 minute'
     ORDER BY open_at LIMIT 500
  $$;
REVOKE ALL ON FUNCTION app.overdue_checkins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.overdue_checkins() TO bargu_app;

-- The sweep: fired alerts a day after they fired, unseen or not.
CREATE FUNCTION app.expire_checkins() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.checkins
     WHERE ctid IN (
       SELECT ctid FROM app.checkins
        WHERE fired_at IS NOT NULL AND fired_at <= now() - interval '24 hours' LIMIT 5000
     );
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_checkins() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_checkins() TO bargu_app;
