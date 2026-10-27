-- Messages and moments (docs/ADR/0035): items for a circle or for one person, and their photo
-- files, all gone 24 hours after they were sent. The server holds only what the phones sealed:
-- whose, for which circle or person, when, the size class; never a word or a picture.
-- Runs as bargu_owner.

-- A sealed photo: version ‖ nonce ‖ key commitment ‖ ChaCha20-Poly1305 of a JPEG (packages/crypto
-- chat.ts), at most 600 KB. Kept in the database like profile photos: no folder on the server, row
-- security decides who may fetch it, and it goes with its rows. The nightly backup leaves it out.
CREATE TABLE app.media_blobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 62 AND 614400),
  size integer GENERATED ALWAYS AS (octet_length(bytes)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX media_blobs_owner ON app.media_blobs (owner_id, created_at);
CREATE INDEX media_blobs_expires ON app.media_blobs (expires_at);

-- An item: for a circle (its sender key's chat envelope) or for one person (sealed to their
-- device), never both. The envelope is 1024 or 8192 bytes of ciphertext.
CREATE TABLE app.chat_items (
  id uuid PRIMARY KEY,
  circle_id uuid REFERENCES app.circles (id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES app.users (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 12000),
  -- The photo the item shares, so the file goes when its last item goes.
  blob_id uuid REFERENCES app.media_blobs (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  CHECK ((circle_id IS NULL) <> (recipient_id IS NULL)),
  CHECK (recipient_id IS NULL OR recipient_id <> sender_id)
);
CREATE INDEX chat_items_circle ON app.chat_items (circle_id, created_at)
  WHERE circle_id IS NOT NULL;
CREATE INDEX chat_items_recipient ON app.chat_items (recipient_id, created_at)
  WHERE recipient_id IS NOT NULL;
CREATE INDEX chat_items_sender ON app.chat_items (sender_id, created_at);
CREATE INDEX chat_items_expires ON app.chat_items (expires_at);
CREATE INDEX chat_items_blob ON app.chat_items (blob_id) WHERE blob_id IS NOT NULL;

-- Who blocked whom (docs/ADR/0035 §6). Kept until the account goes: the user's own protection.
CREATE TABLE app.blocks (
  blocker_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON app.blocks (blocked_id);

ALTER TABLE app.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.blocks FORCE ROW LEVEL SECURITY;
-- A user sees and changes only their own blocks; the blocked never learn of them.
CREATE POLICY blocks_own ON app.blocks
  USING (blocker_id = app.current_user_id())
  WITH CHECK (blocker_id = app.current_user_id());
GRANT SELECT, INSERT, DELETE ON app.blocks TO bargu_app;

-- Whether p_user blocked the caller: an item for them is then dropped, quietly (the server answers
-- as if it went). SECURITY DEFINER: the caller cannot read the other's blocks, and learns only this.
CREATE FUNCTION app.blocked_by(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.blocks
       WHERE blocker_id = p_user AND blocked_id = app.current_user_id()
    )
  $$;
REVOKE ALL ON FUNCTION app.blocked_by(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.blocked_by(uuid) TO bargu_app;

-- Whether the caller uploaded this file. SECURITY DEFINER: the item policy below may not read
-- media_blobs under its own policy, which reads chat_items (Postgres refuses that loop).
CREATE FUNCTION app.owns_blob(p_blob uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM app.media_blobs WHERE id = p_blob AND owner_id = app.current_user_id()
    )
  $$;
REVOKE ALL ON FUNCTION app.owns_blob(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.owns_blob(uuid) TO bargu_app;

ALTER TABLE app.chat_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.chat_items FORCE ROW LEVEL SECURITY;
-- The sender always sees their own. A circle's item: its active members who were in it when it
-- was sent (a later member never received the key). An item for a person: that person. Never what
-- someone the reader blocked sent.
CREATE POLICY chat_items_read ON app.chat_items FOR SELECT
  USING (
    sender_id = app.current_user_id()
    OR (
      NOT EXISTS (
        SELECT 1 FROM app.blocks
         WHERE blocker_id = app.current_user_id() AND blocked_id = chat_items.sender_id
      )
      AND (
        recipient_id = app.current_user_id()
        OR (
          circle_id IS NOT NULL
          AND app.is_active_member(circle_id, app.current_user_id())
          AND created_at >= app.my_join(circle_id)
        )
      )
    )
  );
-- One's own items only: to a circle one is active in, or to someone one shares a circle with,
-- with a photo one uploaded.
CREATE POLICY chat_items_write ON app.chat_items FOR INSERT
  WITH CHECK (
    sender_id = app.current_user_id()
    AND (
      (circle_id IS NOT NULL AND app.is_active_member(circle_id, app.current_user_id()))
      OR (recipient_id IS NOT NULL AND app.shares_circle_with(recipient_id))
    )
    AND (blob_id IS NULL OR app.owns_blob(blob_id))
  );
-- The sender takes an item back from everyone.
CREATE POLICY chat_items_delete ON app.chat_items FOR DELETE
  USING (sender_id = app.current_user_id());
GRANT SELECT, INSERT, DELETE ON app.chat_items TO bargu_app;

ALTER TABLE app.media_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.media_blobs FORCE ROW LEVEL SECURITY;
-- The owner, and whoever can read an item that shares the file (that item's rules decide).
CREATE POLICY media_blobs_read ON app.media_blobs FOR SELECT
  USING (
    owner_id = app.current_user_id()
    OR EXISTS (SELECT 1 FROM app.chat_items WHERE chat_items.blob_id = media_blobs.id)
  );
CREATE POLICY media_blobs_write ON app.media_blobs FOR INSERT
  WITH CHECK (owner_id = app.current_user_id());
CREATE POLICY media_blobs_delete ON app.media_blobs FOR DELETE
  USING (owner_id = app.current_user_id());
GRANT SELECT, INSERT, DELETE ON app.media_blobs TO bargu_app;

-- The bytes of every live file together, against MEDIA_MAX_BYTES (docs/ADR/0035 §10).
CREATE FUNCTION app.media_bytes() RETURNS bigint
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT coalesce(sum(size), 0)::bigint FROM app.media_blobs $$;
REVOKE ALL ON FUNCTION app.media_bytes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.media_bytes() TO bargu_app;

-- Whoever leaves a circle, or is removed from it, takes their items in it along ("çemberden
-- çıkmak iz bırakmaz"); their files go with the sweep once nothing shares them.
CREATE FUNCTION app.drop_departed_items() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF OLD.status = 'active' AND NEW.status IN ('left', 'removed') THEN
      DELETE FROM app.chat_items WHERE circle_id = NEW.circle_id AND sender_id = NEW.user_id;
    END IF;
    RETURN NULL;
  END
  $$;
REVOKE ALL ON FUNCTION app.drop_departed_items() FROM PUBLIC;
CREATE TRIGGER circle_members_departed_items AFTER UPDATE OF status ON app.circle_members
  FOR EACH ROW EXECUTE FUNCTION app.drop_departed_items();

-- 24 hours after they were sent, items and files go; so does a file nothing shares any more (its
-- items deleted, its event ended) or never shared within ten minutes of its upload. The worker
-- calls this; at most 5000 rows of each per call, again while it returns that many.
CREATE FUNCTION app.expire_chat() RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    items integer;
    files integer;
  BEGIN
    DELETE FROM app.chat_items
     WHERE ctid IN (SELECT ctid FROM app.chat_items WHERE expires_at <= now() LIMIT 5000);
    GET DIAGNOSTICS items = ROW_COUNT;
    DELETE FROM app.media_blobs
     WHERE ctid IN (
       SELECT b.ctid FROM app.media_blobs b
        WHERE b.expires_at <= now()
           OR (
             b.created_at < now() - interval '10 minutes'
             AND NOT EXISTS (SELECT 1 FROM app.chat_items i WHERE i.blob_id = b.id)
           )
        LIMIT 5000
     );
    GET DIAGNOSTICS files = ROW_COUNT;
    RETURN greatest(items, files);
  END
  $$;
REVOKE ALL ON FUNCTION app.expire_chat() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_chat() TO bargu_app;

-- The device an item for p_user is sealed to and notified on: their one active device, if the
-- caller shares a circle with them; nothing otherwise (strangers' devices stay unknown).
CREATE FUNCTION app.direct_device_of(p_user uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT d.id FROM app.devices d
     WHERE d.user_id = p_user AND d.revoked_at IS NULL AND app.shares_circle_with(p_user)
     ORDER BY d.created_at DESC
     LIMIT 1
  $$;
REVOKE ALL ON FUNCTION app.direct_device_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.direct_device_of(uuid) TO bargu_app;
