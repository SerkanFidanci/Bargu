-- "Eve vardım kontrolü": the checks set, kept a day (QA-44 Düşük 4, the PM). A cancelled check is
-- deleted at once (ADR 0039), so the daily limit could not see it: set and cancel, again and again,
-- went past ten. And a late copy of a request whose answer was lost could set a cancelled check
-- again. This keeps only the id, its owner and when it was set: nothing of the check, its time or
-- its recipients. The daily limit counts these; an id here is never set twice. Runs as bargu_owner.

CREATE TABLE app.checkin_setups (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkin_setups_owner ON app.checkin_setups (owner_id, created_at);

-- No policy and no grant: only the functions below read or write it.
ALTER TABLE app.checkin_setups ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.checkin_setups FORCE ROW LEVEL SECURITY;

-- The checks of the last day before this migration count too.
INSERT INTO app.checkin_setups (id, owner_id, created_at)
  SELECT id, owner_id, created_at FROM app.checkins WHERE created_at > now() - interval '24 hours'
  ON CONFLICT (id) DO NOTHING;

-- As in 0045, but the day's limit counts the checks set (not the rows still there), and an id
-- that was set and is gone since (cancelled, or fired and seen) is refused: 'NOT_FOUND' to its
-- owner. Asking again with the id of a check still there (a lost answer) is still 'ok'.
CREATE OR REPLACE FUNCTION app.create_checkin(
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
    IF EXISTS (SELECT 1 FROM app.checkin_setups WHERE id = p_id) THEN
      RETURN CASE WHEN EXISTS (SELECT 1 FROM app.checkin_setups WHERE id = p_id AND owner_id = v_me)
                  THEN 'NOT_FOUND' ELSE 'INVALID' END;
    END IF;
    IF p_open_at < now() + p_min OR p_open_at > now() + p_max THEN RETURN 'TIME'; END IF;
    IF (SELECT count(*) FROM app.checkins WHERE owner_id = v_me AND fired_at IS NULL)
       >= p_max_active THEN
      RETURN 'TOO_MANY';
    END IF;
    IF (SELECT count(*) FROM app.checkin_setups
         WHERE owner_id = v_me AND created_at > now() - interval '24 hours') >= p_per_day THEN
      RETURN 'DAILY_LIMIT';
    END IF;
    IF NOT app.checkin_boxes_ok(v_me, p_boxes, p_max_recipients) THEN RETURN 'RECIPIENT'; END IF;
    INSERT INTO app.checkins (id, owner_id, open_at) VALUES (p_id, v_me, p_open_at);
    INSERT INTO app.checkin_setups (id, owner_id) VALUES (p_id, v_me);
    PERFORM app.put_checkin_boxes(p_id, p_boxes);
    RETURN 'ok';
  END
  $$;

-- As in 0045, and the setups go a day after they were made.
CREATE OR REPLACE FUNCTION app.expire_checkins() RETURNS integer
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
    DELETE FROM app.checkin_setups
     WHERE ctid IN (
       SELECT ctid FROM app.checkin_setups WHERE created_at <= now() - interval '24 hours' LIMIT 5000
     );
    RETURN removed;
  END
  $$;
