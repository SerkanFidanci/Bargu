-- Same as migration 0031, one call per child at a time (QA 21 B-1): two "ask my parent" taps at
-- once both found no request and both inserted, the second hit the one-purchase-per-child index
-- (500). The second now waits for the first and finds its request. Runs as bargu_owner.
CREATE OR REPLACE FUNCTION app.ask_guardians_for_purchase(p_product text)
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
    -- Until the end of the caller's transaction.
    PERFORM pg_advisory_xact_lock(hashtextextended('guardian-purchase:' || me::text, 0));
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
