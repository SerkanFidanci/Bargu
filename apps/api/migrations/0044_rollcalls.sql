-- Event roll calls, "Herkes yerinde mi?" (docs/ADR/0040): an event's owner asks, members say
-- "Buradayım", and it closes after ten minutes. The question and the answers are sealed with the
-- circle's chat key; the server holds who asked, who may answer, who answered and when, and
-- nothing of where (an answer carries no location). Gone 24 hours after it began, with the event,
-- or with an account. Runs as bargu_owner.

-- "Etkinlik yoklamaları" (ADR 0040 §6): whether this person takes part. Everyone can turn it off,
-- so a member left out of a roll call can be anyone (15–17 in a large event never say why).
ALTER TABLE app.users ADD COLUMN rollcalls boolean NOT NULL DEFAULT true;
GRANT UPDATE (rollcalls) ON app.users TO bargu_app;

CREATE TABLE app.rollcalls (
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  started_by uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  -- Open until then; "Bitir" brings it forward (closed_at says it was ended by hand).
  closes_at timestamptz NOT NULL,
  closed_at timestamptz,
  -- Who may answer, fixed when it began; how many members were left out (never who or why).
  eligible uuid[] NOT NULL,
  out_count smallint NOT NULL CHECK (out_count >= 0),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 12000),
  CHECK (closes_at > started_at)
);
CREATE INDEX rollcalls_circle ON app.rollcalls (circle_id, started_at);
CREATE INDEX rollcalls_started ON app.rollcalls (started_at);

CREATE TABLE app.rollcall_answers (
  rollcall_id uuid NOT NULL REFERENCES app.rollcalls (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  answered_at timestamptz NOT NULL DEFAULT now(),
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 12000),
  PRIMARY KEY (rollcall_id, user_id)
);

ALTER TABLE app.rollcalls ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rollcalls FORCE ROW LEVEL SECURITY;
ALTER TABLE app.rollcall_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rollcall_answers FORCE ROW LEVEL SECURITY;

-- Read by the circle's owners and by those who may answer it; nobody else, not even other members
-- (15–17 in a large event do not see it at all, ADR 0040 §8). Written only through the functions.
CREATE POLICY rollcalls_read ON app.rollcalls FOR SELECT
  USING (
    app.is_active_member(circle_id, app.current_user_id())
    AND (app.is_circle_owner(circle_id) OR app.current_user_id() = ANY (eligible))
  );
GRANT SELECT ON app.rollcalls TO bargu_app;

-- Whether the caller may read a roll call: SECURITY DEFINER, so the answers' policy need not read
-- app.rollcalls under its own policy.
CREATE FUNCTION app.sees_rollcall(p_rollcall uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.rollcalls r
       WHERE r.id = p_rollcall
         AND app.is_active_member(r.circle_id, app.current_user_id())
         AND (app.is_circle_owner(r.circle_id) OR app.current_user_id() = ANY (r.eligible))
    )
  $$;
REVOKE ALL ON FUNCTION app.sees_rollcall(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.sees_rollcall(uuid) TO bargu_app;

CREATE POLICY rollcall_answers_read ON app.rollcall_answers FOR SELECT
  USING (app.sees_rollcall(rollcall_id));
GRANT SELECT ON app.rollcall_answers TO bargu_app;

-- Starts a roll call for the caller, an owner of an event that has not ended. One open at a time
-- per circle, six an hour. Returns 'ok' or why not. Who may answer is fixed here: the circle's
-- active members but the caller, who have not turned roll calls off, and 15–17 only in circles of
-- at most eight members (ADR 0040 §4, the PM).
CREATE FUNCTION app.start_rollcall(
  p_id uuid,
  p_circle uuid,
  p_open interval,
  p_per_hour integer,
  p_teen_max integer,
  p_envelope jsonb
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_me uuid := app.current_user_id();
    v_end timestamptz := app.event_end(p_circle);
    v_members integer;
    v_eligible uuid[];
  BEGIN
    IF v_me IS NULL OR NOT app.is_active_member(p_circle, v_me) THEN RETURN 'NOT_OWNER'; END IF;
    IF v_end IS NULL OR v_end <= now() THEN RETURN 'NOT_EVENT'; END IF;
    IF NOT app.is_circle_owner(p_circle) THEN RETURN 'NOT_OWNER'; END IF;
    -- Two owners at once: one starts, the other finds it open.
    PERFORM pg_advisory_xact_lock(hashtextextended('rollcall:' || p_circle::text, 0));
    IF EXISTS (
      SELECT 1 FROM app.rollcalls
       WHERE circle_id = p_circle AND closed_at IS NULL AND closes_at > now()
    ) THEN
      RETURN 'ALREADY_OPEN';
    END IF;
    IF (
      SELECT count(*) FROM app.rollcalls
       WHERE circle_id = p_circle AND started_at > now() - interval '1 hour'
    ) >= p_per_hour THEN
      RETURN 'RATE_LIMITED';
    END IF;
    SELECT count(*) INTO v_members
      FROM app.circle_members WHERE circle_id = p_circle AND status = 'active';
    SELECT coalesce(array_agg(m.user_id ORDER BY m.user_id), '{}') INTO v_eligible
      FROM app.circle_members m
      JOIN app.users u ON u.id = m.user_id
     WHERE m.circle_id = p_circle AND m.status = 'active' AND m.user_id <> v_me
       AND u.deleted_at IS NULL
       AND u.rollcalls
       AND NOT (u.age_band = '15-17' AND v_members > p_teen_max);
    INSERT INTO app.rollcalls (id, circle_id, started_by, closes_at, eligible, out_count, envelope)
    VALUES (
      p_id, p_circle, v_me, now() + p_open, v_eligible,
      greatest(v_members - 1 - cardinality(v_eligible), 0), p_envelope
    );
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.start_rollcall(uuid, uuid, interval, integer, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.start_rollcall(uuid, uuid, interval, integer, integer, jsonb)
  TO bargu_app;

-- "Buradayım" from the caller: only to an open roll call they may answer, and once (a second
-- answer does not replace the first). Returns 'ok' or why not.
CREATE FUNCTION app.answer_rollcall(p_rollcall uuid, p_envelope jsonb) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_me uuid := app.current_user_id();
    v_call app.rollcalls%ROWTYPE;
  BEGIN
    SELECT * INTO v_call FROM app.rollcalls WHERE id = p_rollcall;
    IF NOT FOUND OR v_me IS NULL OR NOT (v_me = ANY (v_call.eligible))
       OR NOT app.is_active_member(v_call.circle_id, v_me) THEN
      RETURN 'NOT_ELIGIBLE';
    END IF;
    IF v_call.closed_at IS NOT NULL OR v_call.closes_at <= now() THEN RETURN 'CLOSED'; END IF;
    INSERT INTO app.rollcall_answers (rollcall_id, user_id, envelope)
    VALUES (p_rollcall, v_me, p_envelope)
    ON CONFLICT (rollcall_id, user_id) DO NOTHING;
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.answer_rollcall(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.answer_rollcall(uuid, jsonb) TO bargu_app;

-- "Bitir": an owner of the circle ends an open roll call now. Returns 'ok' or why not.
CREATE FUNCTION app.close_rollcall(p_rollcall uuid) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    v_circle uuid;
  BEGIN
    SELECT circle_id INTO v_circle FROM app.rollcalls WHERE id = p_rollcall;
    IF NOT FOUND OR NOT app.is_circle_owner(v_circle) THEN RETURN 'NOT_OWNER'; END IF;
    UPDATE app.rollcalls
       SET closed_at = now(), closes_at = greatest(least(closes_at, now()), started_at + interval '1 millisecond')
     WHERE id = p_rollcall AND closed_at IS NULL AND closes_at > now();
    IF NOT FOUND THEN RETURN 'CLOSED'; END IF;
    RETURN 'ok';
  END
  $$;
REVOKE ALL ON FUNCTION app.close_rollcall(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_rollcall(uuid) TO bargu_app;

-- The worker's sweep: roll calls 24 hours after they began, with their answers.
CREATE FUNCTION app.expire_rollcalls() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.rollcalls
     WHERE ctid IN (
       SELECT ctid FROM app.rollcalls WHERE started_at <= now() - interval '24 hours' LIMIT 5000
     );
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_rollcalls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_rollcalls() TO bargu_app;
