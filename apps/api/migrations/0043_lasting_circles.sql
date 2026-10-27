-- QA-38 (docs/ADR/0035 §1, §7, §8). Runs as bargu_owner. Only adds, or narrows who may write (a
-- policy and a function body), which the running release survives: it sends what it sent before.

-- O2. Two people write to each other alone only while they share a lasting circle: one that is not
-- an event (people met once at an event talk in the event's own conversation). Both active.
CREATE FUNCTION app.lasting_circle_between(p_a uuid, p_b uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM app.circle_members a
        JOIN app.circle_members b ON b.circle_id = a.circle_id
        JOIN app.circles c ON c.id = a.circle_id
       WHERE a.user_id = p_a AND a.status = 'active'
         AND b.user_id = p_b AND b.status = 'active'
         AND c.kind <> 'event'
    )
  $$;
REVOKE ALL ON FUNCTION app.lasting_circle_between(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.lasting_circle_between(uuid, uuid) TO bargu_app;

-- The device an item for one person is sealed to: only someone the caller shares a lasting circle
-- with (it was any circle).
CREATE OR REPLACE FUNCTION app.direct_device_of(p_user uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT d.id FROM app.devices d
     WHERE d.user_id = p_user AND d.revoked_at IS NULL
       AND app.lasting_circle_between(app.current_user_id(), p_user)
     ORDER BY d.created_at DESC
     LIMIT 1
  $$;

ALTER POLICY chat_items_write ON app.chat_items
  WITH CHECK (
    sender_id = app.current_user_id()
    AND (
      (circle_id IS NOT NULL AND app.is_active_member(circle_id, app.current_user_id()))
      OR (
        recipient_id IS NOT NULL
        AND app.lasting_circle_between(app.current_user_id(), recipient_id)
      )
    )
    AND (blob_id IS NULL OR app.owns_blob(blob_id))
  );

-- When two people's last lasting circle goes (one leaves, is removed, the friendship ends), what
-- they wrote to each other alone goes too ("çemberden çıkmak iz bırakmaz"), not 24 hours later.
CREATE FUNCTION app.drop_lapsed_direct_items() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF OLD.status <> 'active' OR (TG_OP = 'UPDATE' AND NEW.status = 'active') THEN
      RETURN NULL;
    END IF;
    DELETE FROM app.chat_items i
     WHERE i.recipient_id IS NOT NULL
       AND (i.sender_id = OLD.user_id OR i.recipient_id = OLD.user_id)
       AND NOT app.lasting_circle_between(i.sender_id, i.recipient_id);
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.drop_lapsed_direct_items() FROM PUBLIC;
CREATE TRIGGER circle_members_lapsed_direct AFTER UPDATE OF status OR DELETE ON app.circle_members
  FOR EACH ROW EXECUTE FUNCTION app.drop_lapsed_direct_items();

-- A file goes with the last item that shares it (taken back, an event ended, the sender left),
-- at once instead of with the next sweep. A story shared to several circles stays while one does.
CREATE FUNCTION app.drop_unshared_blob() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    DELETE FROM app.media_blobs b
     WHERE b.id = OLD.blob_id
       AND NOT EXISTS (SELECT 1 FROM app.chat_items i WHERE i.blob_id = OLD.blob_id);
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.drop_unshared_blob() FROM PUBLIC;
CREATE TRIGGER chat_items_unshared_blob AFTER DELETE ON app.chat_items
  FOR EACH ROW WHEN (OLD.blob_id IS NOT NULL) EXECUTE FUNCTION app.drop_unshared_blob();
