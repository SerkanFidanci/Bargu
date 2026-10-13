-- Faz 2: accounts, devices, passkeys, sessions (docs/ADR/0005-auth-and-devices.md).
-- Runs as bargu_owner (see src/db/migrate.ts). The runtime role bargu_app owns nothing, cannot
-- bypass row-level security and gets only the grants listed here.

-- The user an API request acts for: set per transaction with set_config('app.user_id', …, true).
-- NULL when unset, so every policy below matches no row without it.
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

CREATE TABLE app.users (
  id uuid PRIMARY KEY,
  -- HMAC-SHA256 of the normalised address under a server key; the address itself is never stored.
  email_hmac bytea NOT NULL UNIQUE CHECK (octet_length(email_hmac) = 32),
  username text UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,20}$'),
  display_name text CHECK (char_length(display_name) BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TYPE app.platform AS ENUM ('ios', 'android');
CREATE TYPE app.attestation_kind AS ENUM ('app_attest', 'play_integrity');
CREATE TYPE app.revocation_reason AS ENUM ('replaced', 'logout', 'remote', 'refresh_reuse');

CREATE TABLE app.devices (
  -- Chosen by the device (it is signed into the key bundle); never reused after revocation.
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  platform app.platform NOT NULL,
  identity_key bytea NOT NULL UNIQUE CHECK (octet_length(identity_key) = 32),
  dh_key bytea NOT NULL CHECK (octet_length(dh_key) = 32),
  dh_key_signature bytea NOT NULL CHECK (octet_length(dh_key_signature) = 64),
  attestation app.attestation_kind,
  attested_at timestamptz,
  push_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason app.revocation_reason,
  CHECK ((attestation IS NULL) = (attested_at IS NULL)),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
-- BARGU_PLAN §1: one active device per account, enforced by the database itself.
CREATE UNIQUE INDEX devices_one_active_per_user ON app.devices (user_id) WHERE revoked_at IS NULL;

CREATE TABLE app.passkeys (
  credential_id bytea PRIMARY KEY CHECK (octet_length(credential_id) BETWEEN 16 AND 1023),
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  public_key bytea NOT NULL CHECK (octet_length(public_key) <= 1024),
  counter bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports text[] NOT NULL DEFAULT '{}',
  backed_up boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX passkeys_user ON app.passkeys (user_id);

CREATE TABLE app.refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES app.devices (id) ON DELETE CASCADE,
  -- One family per login; every rotation stays in it. Reuse of a rotated token revokes the family.
  family_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  replaced_by uuid REFERENCES app.refresh_tokens (id) ON DELETE SET NULL,
  revoked_at timestamptz
);
CREATE INDEX refresh_tokens_family ON app.refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user ON app.refresh_tokens (user_id);

-- Shown to the user in Faz 9 ("güvenlik olayları"). No IP addresses: not needed, so not kept.
CREATE TABLE app.security_events (
  id uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  type text NOT NULL CHECK (
    type IN ('login_otp', 'login_passkey', 'device_replaced', 'refresh_reuse', 'passkey_added', 'logout')
  ),
  device_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user ON app.security_events (user_id, created_at DESC);

-- Row-level security on every table; FORCE so that even the owner is subject to it (bargu_owner
-- itself carries BYPASSRLS only so that the narrow SECURITY DEFINER function below can work).
ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self ON app.users
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());

ALTER TABLE app.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_owner ON app.devices
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE app.passkeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.passkeys FORCE ROW LEVEL SECURITY;
CREATE POLICY passkeys_owner ON app.passkeys
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE app.refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY refresh_tokens_owner ON app.refresh_tokens
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

ALTER TABLE app.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.security_events FORCE ROW LEVEL SECURITY;
CREATE POLICY security_events_owner ON app.security_events
  USING (user_id = app.current_user_id())
  WITH CHECK (user_id = app.current_user_id());

-- The one pre-authentication lookup: which account (if any) an email address belongs to. Needs the
-- keyed hash, which only the server can compute; returns an id and nothing else.
CREATE FUNCTION app.user_id_for_email(p_email_hmac bytea) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$ SELECT id FROM app.users WHERE email_hmac = p_email_hmac AND deleted_at IS NULL $$;
REVOKE ALL ON FUNCTION app.user_id_for_email(bytea) FROM PUBLIC;

-- Least privilege for the runtime role.
GRANT EXECUTE ON FUNCTION app.current_user_id() TO bargu_app;
GRANT EXECUTE ON FUNCTION app.user_id_for_email(bytea) TO bargu_app;
GRANT SELECT, INSERT, UPDATE (username, display_name) ON app.users TO bargu_app;
GRANT SELECT, INSERT, UPDATE (last_seen_at, push_token, revoked_at, revoked_reason) ON app.devices TO bargu_app;
GRANT SELECT, INSERT, UPDATE (counter, last_used_at), DELETE ON app.passkeys TO bargu_app;
GRANT SELECT, INSERT, UPDATE (used_at, replaced_by, revoked_at) ON app.refresh_tokens TO bargu_app;
GRANT SELECT, INSERT ON app.security_events TO bargu_app;
