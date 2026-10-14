-- Profile photos, end-to-end encrypted (docs/ADR/0014). The phone encrypts the photo with a fresh
-- key and shares that key with its circles inside encrypted messages; the server keeps only the
-- ciphertext and cannot see the picture.

-- Whether the caller and p_user are both active in some circle. SECURITY DEFINER: the policy
-- below cannot read circle_members rows it is not allowed to see.
CREATE FUNCTION app.shares_circle_with(p_user uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM app.circle_members mine
        JOIN app.circle_members theirs ON theirs.circle_id = mine.circle_id
       WHERE mine.user_id = app.current_user_id() AND mine.status = 'active'
         AND theirs.user_id = p_user AND theirs.status = 'active'
    )
  $$;
REVOKE ALL ON FUNCTION app.shares_circle_with(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.shares_circle_with(uuid) TO bargu_app;

CREATE TABLE app.profile_photos (
  user_id uuid PRIMARY KEY REFERENCES app.users (id) ON DELETE CASCADE,
  -- Changes with every new photo; the key that opens it travels with this id (never stored here).
  photo_id uuid NOT NULL,
  -- version ‖ nonce ‖ XChaCha20-Poly1305 ciphertext of a small JPEG (packages/crypto profile.ts).
  ciphertext bytea NOT NULL CHECK (octet_length(ciphertext) BETWEEN 42 AND 41001),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.profile_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profile_photos FORCE ROW LEVEL SECURITY;
-- The owner writes their own; people in a circle with them can fetch the (encrypted) photo.
CREATE POLICY profile_photos_own ON app.profile_photos
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
CREATE POLICY profile_photos_shared ON app.profile_photos FOR SELECT
  USING (app.shares_circle_with(user_id));

GRANT SELECT, INSERT, UPDATE (photo_id, ciphertext, updated_at), DELETE ON app.profile_photos TO bargu_app;
