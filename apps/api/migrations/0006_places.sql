-- Places of a circle (BARGU_PLAN §4.3 "Yerler", docs/ADR/0015), end-to-end encrypted: each row is
-- the signed, encrypted `place` message of the member who last saved it. The server sees which
-- circle has how many places and when they change; never a name, a position or a radius.

CREATE TABLE app.places (
  -- Chosen by the phone (it is also inside the encrypted message, which the phone checks).
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES app.circles (id) ON DELETE CASCADE,
  -- MessageEnvelope (packages/schemas envelope.ts): fixed-size ciphertext, about 900 bytes.
  envelope jsonb NOT NULL CHECK (octet_length(envelope::text) BETWEEN 100 AND 2000),
  -- Grows with every save: phones replace a place only from the version they read.
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_circle ON app.places (circle_id);

ALTER TABLE app.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.places FORCE ROW LEVEL SECURITY;
-- Active members read and change their circle's places; nobody else sees that they exist.
CREATE POLICY places_members ON app.places
  USING (app.is_active_member(circle_id, app.current_user_id()))
  WITH CHECK (app.is_active_member(circle_id, app.current_user_id()));

GRANT SELECT, INSERT, UPDATE (envelope, version, updated_at), DELETE ON app.places TO bargu_app;
