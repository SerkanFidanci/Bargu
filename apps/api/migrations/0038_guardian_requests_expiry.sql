-- The worker's 7-day expiry of unanswered guardian requests (migration 0023) also says whose they
-- were, so that both sides hear it (an event for every state change, CLAUDE.md): the child's phone
-- (its plan says what waits: a Bargu+ or a pack request, docs/ADR/0024 §5, 0025 §6) and the
-- parents' open view. One row per request that went: whose it was (child_id), what it asked
-- (kind), and the child's active parents then (guardian_ids; none when the last link already
-- ended). Runs as bargu_owner.

DROP FUNCTION app.expire_guardian_tools();
CREATE FUNCTION app.expire_guardian_tools()
  RETURNS TABLE (child_id uuid, kind text, guardian_ids uuid[])
  LANGUAGE sql SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    WITH old_minutes AS (
      DELETE FROM app.usage_days WHERE day < current_date - 7
    ), gone AS (
      DELETE FROM app.guardian_requests r WHERE r.created_at < now() - interval '7 days'
      RETURNING r.child_id, r.kind
    )
    SELECT g.child_id, g.kind,
           coalesce((SELECT array_agg(l.guardian_id) FROM app.guardian_links l
                      WHERE l.child_id = g.child_id AND l.status = 'active'),
                    ARRAY[]::uuid[])
      FROM gone g
  $$;
REVOKE ALL ON FUNCTION app.expire_guardian_tools() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.expire_guardian_tools() TO bargu_app;
