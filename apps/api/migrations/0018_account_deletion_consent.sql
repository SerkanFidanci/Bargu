-- Deleting an account, and the records KVKK asks to keep of the information notice and of explicit
-- consent (docs/ADR/0022). Runs as bargu_owner.

-- Why a device stopped: its account was deleted.
ALTER TYPE app.revocation_reason ADD VALUE IF NOT EXISTS 'account_deleted';

-- The notice read ("Okudum, anladım", purpose 'notice') and explicit consent ('history': location
-- history, the only processing that rests on consent). One row per purpose: the latest version
-- given, and when it was withdrawn.
CREATE TABLE app.consents (
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('notice', 'history')),
  version integer NOT NULL CHECK (version >= 1),
  given_at timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz,
  PRIMARY KEY (user_id, purpose)
);
ALTER TABLE app.consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consents FORCE ROW LEVEL SECURITY;
CREATE POLICY consents_own ON app.consents
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());
GRANT SELECT, INSERT, UPDATE (version, given_at, withdrawn_at) ON app.consents TO bargu_app;

-- Accounts being deleted: kept until everything outside the database (Redis, queued jobs) is gone
-- too, then the row goes as well. No foreign key: it outlives the user row by a moment. No policy
-- and no grant: only the functions below reach it.
CREATE TABLE app.account_deletions (
  user_id uuid PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now(),
  purged_at timestamptz
);
ALTER TABLE app.account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.account_deletions FORCE ROW LEVEL SECURITY;

-- The caller's account is now being deleted: unusable at once (sign-in refuses it), deleted by the
-- purge. The caller has already left every circle and every device was closed (account service).
CREATE FUNCTION app.request_account_deletion() RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    me uuid := app.current_user_id();
  BEGIN
    IF me IS NULL THEN
      RETURN false;
    END IF;
    UPDATE app.users SET deleted_at = coalesce(deleted_at, now()) WHERE id = me;
    IF NOT FOUND THEN
      RETURN false;
    END IF;
    INSERT INTO app.account_deletions (user_id) VALUES (me) ON CONFLICT DO NOTHING;
    RETURN true;
  END
  $$;

-- Accounts waiting for the purge, oldest first.
CREATE FUNCTION app.pending_account_deletions(p_limit integer) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT user_id FROM app.account_deletions ORDER BY requested_at LIMIT p_limit
  $$;

-- Deletes the user row of an account being deleted (and with it, by cascade, everything tied to it).
-- Only an account that asked for it: nothing else can be deleted through this.
CREATE FUNCTION app.purge_account(p_user uuid) RETURNS boolean
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM app.account_deletions WHERE user_id = p_user) THEN
      RETURN false;
    END IF;
    -- Its friendships (already over for both): their key names the two people.
    DELETE FROM app.circles
     WHERE kind = 'pair'
       AND (split_part(pair_key, ':', 1) = p_user::text OR split_part(pair_key, ':', 2) = p_user::text);
    DELETE FROM app.users WHERE id = p_user AND deleted_at IS NOT NULL;
    UPDATE app.account_deletions SET purged_at = coalesce(purged_at, now()) WHERE user_id = p_user;
    RETURN true;
  END
  $$;

-- Everything outside the database is gone too: nothing of the account is left.
CREATE FUNCTION app.finish_account_deletion(p_user uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    DELETE FROM app.account_deletions WHERE user_id = p_user AND purged_at IS NOT NULL
  $$;

REVOKE ALL ON FUNCTION app.request_account_deletion(), app.pending_account_deletions(integer),
  app.purge_account(uuid), app.finish_account_deletion(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.request_account_deletion(), app.pending_account_deletions(integer),
  app.purge_account(uuid), app.finish_account_deletion(uuid) TO bargu_app;
