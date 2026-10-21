-- A 15-17 account's cosmetic pack waits for a parent's yes (docs/ADR/0025 §6, ADR 0024 §5, slice
-- 3c): the child asks for a pack, the parents see it on the view both sides share, a yes buys it
-- as the child, a no drops it. Apart from a Bargu+ purchase (kind 'purchase', migration 0031): the
-- two never replace or delete each other. One waiting request per pack per child. Always asked,
-- whatever "a yes for new people" says (it is about people). Runs as bargu_owner.

ALTER TABLE app.guardian_requests
  DROP CONSTRAINT guardian_requests_kind_check,
  ADD CONSTRAINT guardian_requests_kind_check
    CHECK (kind IN ('invite', 'friend', 'admit', 'member', 'purchase', 'cosmetic')),
  DROP CONSTRAINT guardian_requests_product_check,
  -- The API knows which packs exist (COSMETIC_PRODUCTS), as for entitlements (migration 0028): a
  -- new pack needs no migration. The id is at most 16 characters, as in a pass (ADR 0025 §1).
  ADD CONSTRAINT guardian_requests_product_check
    CHECK ((kind IN ('purchase', 'cosmetic')) = (product IS NOT NULL)
           AND (product IS NULL
                OR (kind = 'purchase' AND product IN ('plus_month', 'plus_year'))
                OR (kind = 'cosmetic' AND product ~ '^cosmetic:[a-z0-9_]{1,16}$')));
CREATE UNIQUE INDEX guardian_requests_cosmetic ON app.guardian_requests (child_id, product)
  WHERE kind = 'cosmetic';

-- The caller (15-17) asks their parents for a pack: the parents to tell, with whether the request
-- is new now (fresh). None when the caller is not 15-17 or has no active parent: nobody could say
-- yes, and nothing is kept. Asking for the same pack again keeps the one request and tells nobody
-- again; another pack is another request, and a Bargu+ request is never touched. One call per
-- child at a time, as for a purchase (migration 0033).
CREATE FUNCTION app.ask_guardians_for_cosmetic(p_product text)
  RETURNS TABLE (guardian_id uuid, fresh boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
    is_new boolean := false;
  BEGIN
    IF me IS NULL OR p_product !~ '^cosmetic:[a-z0-9_]{1,16}$'
       OR NOT EXISTS (SELECT 1 FROM app.users
                       WHERE id = me AND age_band = '15-17' AND deleted_at IS NULL)
       OR NOT EXISTS (SELECT 1 FROM app.guardian_links
                       WHERE child_id = me AND status = 'active') THEN
      RETURN;
    END IF;
    -- Until the end of the caller's transaction.
    PERFORM pg_advisory_xact_lock(hashtextextended('guardian-cosmetic:' || me::text, 0));
    IF NOT EXISTS (SELECT 1 FROM app.guardian_requests r
                    WHERE r.child_id = me AND r.kind = 'cosmetic' AND r.product = p_product) THEN
      INSERT INTO app.guardian_requests (child_id, kind, product)
        VALUES (me, 'cosmetic', p_product);
      is_new := true;
    END IF;
    RETURN QUERY SELECT l.guardian_id, is_new FROM app.guardian_links l
                  WHERE l.child_id = me AND l.status = 'active';
  END
  $$;
REVOKE ALL ON FUNCTION app.ask_guardians_for_cosmetic(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ask_guardians_for_cosmetic(text) TO bargu_app;

-- Same as migration 0031, and a cosmetic request "works" as a purchase does (a yes buys the pack).
CREATE OR REPLACE FUNCTION app.guardian_requests_of(p_child uuid) RETURNS TABLE (
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
           r.kind IN ('friend', 'member', 'purchase', 'cosmetic')
             OR (i.id IS NOT NULL AND u.id IS NOT NULL),
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
