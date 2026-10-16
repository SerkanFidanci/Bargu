-- Entitlements (docs/ADR/0024): what an account has bought or been given, per account, with where
-- it came from. A circle is open while at least one active member has Bargu+ (or the trial);
-- nobody keeping it open pauses its live location, history and place arrivals. Runs as
-- bargu_owner.

CREATE TYPE app.entitlement_source AS ENUM ('bargu', 'test', 'play', 'appstore');
CREATE TYPE app.entitlement_state AS ENUM ('active', 'grace', 'canceled', 'expired', 'refunded');

CREATE TABLE app.entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  product text NOT NULL
    CHECK (product IN ('trial', 'plus_month', 'plus_year') OR product ~ '^cosmetic:[a-z0-9_]{1,40}$'),
  source app.entitlement_source NOT NULL,
  state app.entitlement_state NOT NULL DEFAULT 'active',
  starts_at timestamptz NOT NULL DEFAULT now(),
  -- Cosmetics are kept for good; everything else runs out.
  expires_at timestamptz CHECK (product LIKE 'cosmetic:%' OR expires_at IS NOT NULL),
  grace_until timestamptz CHECK (state <> 'grace' OR grace_until IS NOT NULL),
  auto_renew boolean NOT NULL DEFAULT false,
  -- A keyed hash of the store's purchase reference (never the token itself); none for test or trial.
  store_ref bytea CHECK (store_ref IS NULL OR octet_length(store_ref) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX entitlements_user ON app.entitlements (user_id);
-- One trial per account.
CREATE UNIQUE INDEX entitlements_one_trial ON app.entitlements (user_id) WHERE product = 'trial';
-- For the worker: plans running out.
CREATE INDEX entitlements_ends ON app.entitlements (expires_at) WHERE product NOT LIKE 'cosmetic:%';
CREATE INDEX entitlements_grace_ends ON app.entitlements (grace_until) WHERE state = 'grace';

ALTER TABLE app.entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.entitlements FORCE ROW LEVEL SECURITY;
-- An account reads and changes its own (test purchases); nobody sees anyone else's.
CREATE POLICY entitlements_own ON app.entitlements
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE (state, expires_at, grace_until, auto_renew, updated_at)
  ON app.entitlements TO bargu_app;

-- Whether an account has Bargu+ right now: the trial or a plan, until it runs out, or in its grace
-- days after a failed payment. Cancelled only means it will not renew.
CREATE FUNCTION app.plus_active(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.entitlements e
       WHERE e.user_id = p_user
         AND e.product IN ('trial', 'plus_month', 'plus_year')
         AND ((e.state IN ('active', 'canceled') AND e.expires_at > now())
              OR (e.state = 'grace' AND e.grace_until > now())))
  $$;
REVOKE ALL ON FUNCTION app.plus_active(uuid) FROM PUBLIC;

-- Open while at least one active member has Bargu+. Answered only to members (yes or no, never who).
CREATE FUNCTION app.circle_is_open(p_circle uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT app.is_circle_member(p_circle)
       AND EXISTS (
         SELECT 1 FROM app.circle_members m
           JOIN app.users u ON u.id = m.user_id AND u.deleted_at IS NULL
          WHERE m.circle_id = p_circle AND m.status = 'active' AND app.plus_active(m.user_id))
  $$;
REVOKE ALL ON FUNCTION app.circle_is_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.circle_is_open(uuid) TO bargu_app;

-- For the worker: accounts whose Bargu+ ran out in (p_since, p_until] (a plan or the trial ended, or
-- its grace days did), so their circles can be told and paused ones emptied of last locations.
CREATE FUNCTION app.plans_ended_between(p_since timestamptz, p_until timestamptz)
  RETURNS TABLE (user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT DISTINCT e.user_id FROM app.entitlements e
     WHERE e.product IN ('trial', 'plus_month', 'plus_year')
       AND ((e.state IN ('active', 'canceled') AND e.expires_at > p_since AND e.expires_at <= p_until)
            OR (e.state = 'grace' AND e.grace_until > p_since AND e.grace_until <= p_until))
  $$;
REVOKE ALL ON FUNCTION app.plans_ended_between(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.plans_ended_between(timestamptz, timestamptz) TO bargu_app;

-- For the worker and after a change: an account's active circles and whether each is open now
-- (no caller: the worker has none; it learns only yes or no per circle, never who pays).
CREATE FUNCTION app.circles_openness_of(p_user uuid)
  RETURNS TABLE (circle_id uuid, epoch integer, open boolean, members uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT c.id, c.epoch,
           EXISTS (SELECT 1 FROM app.circle_members o
                     JOIN app.users u ON u.id = o.user_id AND u.deleted_at IS NULL
                    WHERE o.circle_id = c.id AND o.status = 'active' AND app.plus_active(o.user_id)),
           ARRAY(SELECT a.user_id FROM app.circle_members a
                  WHERE a.circle_id = c.id AND a.status IN ('invited', 'active'))
      FROM app.circles c
      JOIN app.circle_members m ON m.circle_id = c.id AND m.user_id = p_user AND m.status = 'active'
  $$;
REVOKE ALL ON FUNCTION app.circles_openness_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.circles_openness_of(uuid) TO bargu_app;

-- Every new account starts its 21-day trial; the accounts there already start theirs now.
CREATE FUNCTION app.start_trial() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    INSERT INTO app.entitlements (user_id, product, source, starts_at, expires_at)
    VALUES (NEW.id, 'trial', 'bargu', now(), now() + interval '21 days')
    ON CONFLICT DO NOTHING;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION app.start_trial() FROM PUBLIC;
CREATE TRIGGER users_start_trial AFTER INSERT ON app.users
  FOR EACH ROW EXECUTE FUNCTION app.start_trial();

INSERT INTO app.entitlements (user_id, product, source, starts_at, expires_at)
SELECT id, 'trial', 'bargu', now(), now() + interval '21 days'
  FROM app.users WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;
