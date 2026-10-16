-- The database's setting is the one truth on test purchases (QA 21 B-5, docs/ADR/0024 §6): the API
-- reads it and takes test purchases as off whenever it is off, whatever its own flag says (before,
-- the API's flag on and the database's off gave a plan that counted a test row and purchases that
-- failed with 500). The app role may read it through this function only; it still cannot read the
-- table or write the setting (the migrator, as the owner role, writes it). Runs as bargu_owner.
GRANT EXECUTE ON FUNCTION app.billing_test_on() TO bargu_app;
