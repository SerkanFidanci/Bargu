-- Sealed notifications (docs/ADR/0016): every push is a sealed box for one device, sent through
-- FCM (Android, data-only) or APNs (iPhone, opened by the Notification Service Extension). The
-- server now needs to know which of the two a token belongs to. Tokens so far came from Android.

ALTER TABLE app.push_tokens
  ADD COLUMN platform text NOT NULL DEFAULT 'android' CHECK (platform IN ('android', 'ios'));

GRANT UPDATE (platform) ON app.push_tokens TO bargu_app;
