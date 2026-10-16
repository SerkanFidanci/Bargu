-- An account's documents go with it (circle_docs.author_id cascades, migration 0009): a meeting it
-- started, its polls and votes (QA 21 B-3, docs/ADR/0026 §2). The purge tells each circle's
-- members, as every other change to documents is told (docs.changed): this gives it the circles,
-- and their active members, holding what the account wrote. Nothing for an account that is not
-- being deleted. Runs as bargu_owner.
CREATE FUNCTION app.doc_circles_of_deleted(p_user uuid)
  RETURNS TABLE (circle_id uuid, members uuid[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT d.circle_id,
           coalesce((SELECT array_agg(m.user_id ORDER BY m.user_id) FROM app.circle_members m
                      WHERE m.circle_id = d.circle_id AND m.status = 'active'
                        AND m.user_id <> p_user), '{}')
      FROM (SELECT DISTINCT c.circle_id FROM app.circle_docs c WHERE c.author_id = p_user) d
     WHERE EXISTS (SELECT 1 FROM app.account_deletions a WHERE a.user_id = p_user)
  $$;
REVOKE ALL ON FUNCTION app.doc_circles_of_deleted(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.doc_circles_of_deleted(uuid) TO bargu_app;
