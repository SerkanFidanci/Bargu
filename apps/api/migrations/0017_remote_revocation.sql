-- The account web page takes a lost or stolen phone off the account (docs/ADR/0021): a new kind of
-- security event, shown to the user in their list. Runs as bargu_owner.

ALTER TABLE app.security_events DROP CONSTRAINT security_events_type_check;
ALTER TABLE app.security_events ADD CONSTRAINT security_events_type_check CHECK (
  type IN (
    'login_otp', 'login_passkey', 'device_replaced', 'refresh_reuse', 'passkey_added', 'logout',
    'device_revoked_remote'
  )
);
