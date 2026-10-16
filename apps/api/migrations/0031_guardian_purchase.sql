-- A 15-17 account's purchase waits for a parent's yes (docs/ADR/0024 §5, ADR 0023): the child
-- asks for a plan, the parents see it on the view both sides share, a yes buys it as the child,
-- a no drops it. Always asked, whatever "a yes for new people" says (it is about people). One
-- waiting purchase per child: asking for the other plan changes it. Runs as bargu_owner.

ALTER TABLE app.guardian_requests
  ADD COLUMN product text,
  DROP CONSTRAINT guardian_requests_kind_check,
  ADD CONSTRAINT guardian_requests_kind_check
    CHECK (kind IN ('invite', 'friend', 'admit', 'member', 'purchase')),
  ADD CONSTRAINT guardian_requests_product_check
    CHECK ((kind = 'purchase') = (product IS NOT NULL)
           AND (product IS NULL OR product IN ('plus_month', 'plus_year')));
CREATE UNIQUE INDEX guardian_requests_purchase ON app.guardian_requests (child_id)
  WHERE kind = 'purchase';

-- Same as migration 0027, and a purchase request is the same only for the same plan.
CREATE OR REPLACE FUNCTION app.limit_guardian_requests() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    -- The same request again is no new one (the insert does nothing then).
    IF EXISTS (SELECT 1 FROM app.guardian_requests r
                WHERE r.child_id = NEW.child_id AND r.kind = NEW.kind
                  AND r.token_hash IS NOT DISTINCT FROM NEW.token_hash
                  AND r.username IS NOT DISTINCT FROM NEW.username
                  AND r.newcomer_id IS NOT DISTINCT FROM NEW.newcomer_id
                  AND r.circle_id IS NOT DISTINCT FROM NEW.circle_id
                  AND r.product IS NOT DISTINCT FROM NEW.product) THEN
      RETURN NEW;
    END IF;
    IF (SELECT count(*) FROM app.guardian_requests WHERE child_id = NEW.child_id) >= 20
       OR (NEW.newcomer_id IS NOT NULL
           AND (SELECT count(*) FROM app.guardian_requests
                 WHERE newcomer_id = NEW.newcomer_id) >= 5) THEN
      RAISE EXCEPTION 'guardian requests full' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END
  $$;

-- The caller (15-17) asks their parents for a plan: the parents to tell, with whether the request
-- is new now (fresh). None when the caller is not 15-17 or has no active parent: nobody could say
-- yes, and nothing is kept.
CREATE FUNCTION app.ask_guardians_for_purchase(p_product text)
  RETURNS TABLE (guardian_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    before text;
  BEGIN
    IF me IS NULL OR p_product NOT IN ('plus_month', 'plus_year')
       OR NOT EXISTS (SELECT 1 FROM app.users
                       WHERE id = me AND age_band = '15-17' AND deleted_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM app.guardian_links
                       WHERE child_id = me AND status = 'active') THEN
      RETURN;
    END IF;
    SELECT r.product INTO before FROM app.guardian_requests r
     WHERE r.child_id = me AND r.kind = 'purchase';
    IF before IS NULL THEN
      INSERT INTO app.guardian_requests (child_id, kind, product) VALUES (me, 'purchase', p_product);
    ELSIF before <> p_product THEN
      UPDATE app.guardian_requests SET product = p_product, created_at = now()
       WHERE child_id = me AND kind = 'purchase';
    END IF;
    RETURN QUERY SELECT l.guardian_id, before IS DISTINCT FROM p_product FROM app.guardian_links l
                  WHERE l.child_id = me AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_purchase(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_purchase(text) TO bargu_app;

-- Same as migration 0024, and the plan of a purchase.
DROP FUNCTION app.take_guardian_request(uuid);
CREATE FUNCTION app.take_guardian_request(p_request uuid) RETURNS TABLE (
  child_id uuid,
  kind text,
  token_hash bytea,
  username text,
  newcomer_id uuid,
  circle_id uuid,
  product text
)
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.guardian_requests r
     WHERE r.id = p_request AND app.is_guardian_of(r.child_id)
    RETURNING r.child_id, r.kind, r.token_hash, r.username, r.newcomer_id, r.circle_id, r.product
  $$;
REVOKE ALL ON FUNCTION app.take_guardian_request(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.take_guardian_request(uuid) TO bargu_app;

-- Same as migration 0024, and the plan of a purchase (which always "works").
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
  product text,
  created_at timestamptz
)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT r.id, r.kind, c.kind::text, c.name,
           CASE WHEN c.id IS NULL THEN NULL ELSE
             (SELECT count(*)::integer FROM app.circle_members m
               WHERE m.circle_id = c.id AND m.status = 'active') END,
           r.kind IN ('friend', 'member', 'purchase') OR (i.id IS NOT NULL AND u.id IS NOT NULL),
           u.display_name, o.display_name, r.product, r.created_at
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
