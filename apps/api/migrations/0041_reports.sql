-- Reports of messages and moments (docs/ADR/0035 §9): the reporter's phone hands over one item's
-- key, the server checks the sender's signature, the key commitment and the decryption, and keeps
-- what the item said, sealed with its key at rest, for 90 days; a report of child abuse until the
-- owner closes it. Who reported whom stays even when either account goes: it is a safety record.
-- Runs as bargu_owner.

CREATE TABLE app.reports (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  reporter_id uuid NOT NULL,
  reported_id uuid NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('spam', 'harassment', 'sexual', 'child', 'violence', 'other')),
  item_id uuid,
  -- The signature, the key commitment and the decryption held; otherwise nothing is kept of it.
  verified boolean NOT NULL,
  -- The item as read (text, caption, photo), sealed with the server's key at rest.
  content text CHECK (content IS NULL OR verified),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- NULL: kept until the owner closes it (child abuse, docs/ADR/0035 §9).
  retain_until timestamptz,
  closed_at timestamptz,
  CHECK (reporter_id <> reported_id)
);
CREATE INDEX reports_open ON app.reports (created_at) WHERE closed_at IS NULL;
CREATE INDEX reports_retain ON app.reports (retain_until) WHERE retain_until IS NOT NULL;

ALTER TABLE app.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reports FORCE ROW LEVEL SECURITY;
-- A reporter files their own reports and sees that they did; nobody else reads them through the
-- API (the owner reads them on the server).
CREATE POLICY reports_own ON app.reports FOR SELECT
  USING (reporter_id = app.current_user_id());
CREATE POLICY reports_file ON app.reports FOR INSERT
  WITH CHECK (reporter_id = app.current_user_id());
GRANT SELECT, INSERT ON app.reports TO bargu_app;

-- The identity key a reported item was signed with: a device of someone the caller shares a
-- circle with, or who sent the caller an item that is still kept. SECURITY DEFINER: other people's
-- devices are not the caller's to read otherwise.
CREATE FUNCTION app.reported_device(p_device uuid)
  RETURNS TABLE (user_id uuid, identity_key bytea)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT d.user_id, d.identity_key FROM app.devices d
     WHERE d.id = p_device
       AND (
         app.shares_circle_with(d.user_id)
         OR EXISTS (
           SELECT 1 FROM app.chat_items i
            WHERE i.sender_id = d.user_id AND i.recipient_id = app.current_user_id()
         )
       )
  $$;
REVOKE ALL ON FUNCTION app.reported_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reported_device(uuid) TO bargu_app;

-- Reports past their 90 days go (the worker calls this with the items' sweep).
CREATE FUNCTION app.expire_reports() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    removed integer;
  BEGIN
    DELETE FROM app.reports WHERE retain_until IS NOT NULL AND retain_until <= now();
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_reports() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_reports() TO bargu_app;
