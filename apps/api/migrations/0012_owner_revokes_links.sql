-- The owner of a circle may see and revoke every link of it, not only the ones they made (QA Faz 8
-- O2): a QR code of an event that leaked, made by any member, lets strangers in until it is revoked.
-- Runs as bargu_owner.

CREATE POLICY invites_owner_read ON app.invites FOR SELECT
  USING (circle_id IS NOT NULL AND app.is_circle_owner(circle_id));
CREATE POLICY invites_owner_revoke ON app.invites FOR UPDATE
  USING (circle_id IS NOT NULL AND app.is_circle_owner(circle_id))
  WITH CHECK (circle_id IS NOT NULL AND app.is_circle_owner(circle_id));
