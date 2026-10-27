-- The community rules accepted before one's first message or photo (Play's rule for user content,
-- K14; docs/ADR/0035 §9): a third purpose in app.consents, with the version accepted. Runs as
-- bargu_owner. Only widens what a row may hold: the running release reads and writes as before.
ALTER TABLE app.consents DROP CONSTRAINT IF EXISTS consents_purpose_check;
ALTER TABLE app.consents
  ADD CONSTRAINT consents_purpose_check CHECK (purpose IN ('notice', 'history', 'rules'));
