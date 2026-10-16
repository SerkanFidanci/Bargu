-- Test purchases are known to the database too (QA 20 P1b, docs/ADR/0024 §6): the API's flag
-- closes the routes, but someone with SQL access as the app role could still call
-- app.add_test_entitlement and give themselves a long Bargu+. Now the migrator writes the
-- deployment's setting on every run (on only where APP_ENV is not production and BILLING_TEST=on);
-- with it off, test rows count for nothing and none can be written or changed; a test plan ends
-- within a year (and a day, for the clocks of the API and the database: docs/ADR/0024 §6). The app
-- role cannot read or write the setting. Runs as bargu_owner.

CREATE TABLE app.settings (
  key        text PRIMARY KEY CHECK (key ~ '^[a-z_]{1,40}$'),
  value      text NOT NULL CHECK (length(value) <= 200),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.settings FORCE ROW LEVEL SECURITY;
-- No policy and no grant: only the owner role (the migrator, the functions below) reaches it.
REVOKE ALL ON app.settings FROM PUBLIC;

-- Off unless the migrator wrote 'on' (a database without the row is a production one).
CREATE FUNCTION app.billing_test_on() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT coalesce((SELECT s.value = 'on' FROM app.settings s WHERE s.key = 'billing_test'), false)
  $$;
REVOKE ALL ON FUNCTION app.billing_test_on() FROM PUBLIC;

-- A test row counts only where test purchases are on.
CREATE OR REPLACE FUNCTION app.plus_active(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.entitlements e
       WHERE e.user_id = p_user
         AND e.product IN ('trial', 'plus_month', 'plus_year')
         AND (e.source <> 'test' OR app.billing_test_on())
         AND ((e.state IN ('active', 'canceled') AND e.expires_at > now())
              OR (e.state = 'grace' AND e.grace_until > now())))
  $$;

CREATE OR REPLACE FUNCTION app.add_test_entitlement(
  p_product text,
  p_expires_at timestamptz,
  p_auto_renew boolean
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    added uuid;
  BEGIN
    IF me IS NULL OR p_product = 'trial' OR NOT app.billing_test_on() THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    -- A plan ends within a year (and a day); a pack (cosmetic) has none.
    IF (p_product IN ('plus_month', 'plus_year')) <> (p_expires_at IS NOT NULL)
       OR p_expires_at > now() + interval '1 year 1 day' THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO app.entitlements (user_id, product, source, starts_at, expires_at, auto_renew)
    VALUES (me, p_product, 'test', now(), p_expires_at, p_auto_renew)
    RETURNING id INTO added;
    RETURN added;
  END
  $$;

CREATE OR REPLACE FUNCTION app.change_test_entitlement(
  p_id uuid,
  p_state app.entitlement_state,
  p_expires_at timestamptz,
  p_grace_until timestamptz,
  p_auto_renew boolean
) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    changed integer;
  BEGIN
    IF me IS NULL OR NOT app.billing_test_on()
       OR p_expires_at > now() + interval '1 year 1 day'
       OR p_grace_until > now() + interval '1 year 1 day' THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    UPDATE app.entitlements
       SET state = p_state, expires_at = p_expires_at, grace_until = p_grace_until,
           auto_renew = p_auto_renew, updated_at = now()
     WHERE id = p_id AND user_id = me
       AND (source = 'test' OR (product = 'trial' AND p_state = 'expired'));
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed = 1;
  END
  $$;
