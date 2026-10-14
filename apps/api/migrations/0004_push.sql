-- Push notifications (docs/ADR/0010): one token per device, sealed at rest with the server's job
-- payload key, so neither a database dump nor a log ever shows it. Runs as bargu_owner.

CREATE TABLE app.push_tokens (
  device_id uuid PRIMARY KEY REFERENCES app.devices (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app.users (id) ON DELETE CASCADE,
  -- The FCM / APNs token, sealed (XChaCha20-Poly1305, context "push/token").
  token_sealed text NOT NULL CHECK (char_length(token_sealed) BETWEEN 1 AND 8192),
  -- Language of the notification texts (they are written on the server).
  locale text NOT NULL CHECK (locale IN ('tr', 'en')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON app.push_tokens (user_id);

ALTER TABLE app.push_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.push_tokens FORCE ROW LEVEL SECURITY;
-- Only for the caller's own, still active device.
CREATE POLICY push_tokens_own ON app.push_tokens
  USING (user_id = app.current_user_id())
  WITH CHECK (
    user_id = app.current_user_id()
    AND EXISTS (SELECT 1 FROM app.devices d
                 WHERE d.id = device_id AND d.user_id = app.current_user_id()
                   AND d.revoked_at IS NULL)
  );

GRANT SELECT, INSERT, UPDATE (token_sealed, locale, updated_at), DELETE ON app.push_tokens TO bargu_app;
