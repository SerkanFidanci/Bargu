-- Entitlements are written only through these functions (QA 19 P1, docs/ADR/0024): the app role
-- could insert its own row with any source (a 'play' plan for free) because the policy looks at
-- the owner only. Now it can read its own rows and nothing more; test purchases and the trial's
-- end go through functions that write source 'test' (or the caller's trial) only. The worker's
-- functions answer no session (QA 19 P2). Runs as bargu_owner.

REVOKE INSERT, UPDATE ON app.entitlements FROM bargu_app;

-- A test purchase for the caller: a plan or a pack, source 'test', nothing else.
CREATE FUNCTION app.add_test_entitlement(
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
    IF me IS NULL OR p_product = 'trial' THEN
      RAISE EXCEPTION 'not allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
    INSERT INTO app.entitlements (user_id, product, source, starts_at, expires_at, auto_renew)
    VALUES (me, p_product, 'test', now(), p_expires_at, p_auto_renew)
    RETURNING id INTO added;
    RETURN added;
  END
  $$;
REVOKE ALL ON FUNCTION app.add_test_entitlement(text, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.add_test_entitlement(text, timestamptz, boolean) TO bargu_app;

-- What a store would do to one of the caller's test rows (never a store's, never someone else's);
-- also ends the caller's trial (state 'expired'), for trying "the trial ended".
CREATE FUNCTION app.change_test_entitlement(
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
    IF me IS NULL THEN
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
REVOKE ALL ON FUNCTION app.change_test_entitlement(uuid, app.entitlement_state, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.change_test_entitlement(uuid, app.entitlement_state, timestamptz, timestamptz, boolean) TO bargu_app;

-- The worker's functions: nothing for a session (they name other people's circles and plans).
CREATE OR REPLACE FUNCTION app.plans_ended_between(p_since timestamptz, p_until timestamptz)
  RETURNS TABLE (user_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT DISTINCT e.user_id FROM app.entitlements e
     WHERE app.current_user_id() IS NULL
       AND e.product IN ('trial', 'plus_month', 'plus_year')
       AND ((e.state IN ('active', 'canceled') AND e.expires_at > p_since AND e.expires_at <= p_until)
            OR (e.state = 'grace' AND e.grace_until > p_since AND e.grace_until <= p_until))
  $$;

CREATE OR REPLACE FUNCTION app.circles_openness_of(p_user uuid)
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
     WHERE app.current_user_id() IS NULL
  $$;
