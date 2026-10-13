-- Faz 3: profile (username, display name, avatar without photo) and username availability.
-- Runs as bargu_owner (see src/db/migrate.ts).

-- Same rule as USERNAME_PATTERN in packages/schemas: no leading, trailing or repeated dot.
ALTER TABLE app.users DROP CONSTRAINT users_username_check;
ALTER TABLE app.users ADD CONSTRAINT users_username_check
  CHECK (username ~ '^[a-z0-9_.]{3,20}$' AND username !~ '(^\.|\.$|\.\.)');

-- Avatar = palette colour (+ optional emoji from a fixed set, checked by the API). No photo: a
-- photo would be readable by the server; encrypted photos are a later phase.
ALTER TABLE app.users
  ADD COLUMN avatar_color smallint CHECK (avatar_color BETWEEN 0 AND 11),
  ADD COLUMN avatar_emoji text CHECK (octet_length(avatar_emoji) <= 16),
  ADD CONSTRAINT users_avatar_emoji_needs_color CHECK (avatar_emoji IS NULL OR avatar_color IS NOT NULL);

-- Whether a username is in use, by anyone (deleted accounts included until they are purged, so a
-- freed name cannot be taken over to impersonate its former owner). Returns a boolean only.
CREATE FUNCTION app.username_taken(p_username text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT EXISTS (SELECT 1 FROM app.users WHERE username = p_username) $$;
REVOKE ALL ON FUNCTION app.username_taken(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.username_taken(text) TO bargu_app;
GRANT UPDATE (avatar_color, avatar_emoji) ON app.users TO bargu_app;
