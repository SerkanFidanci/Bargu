-- Someone new in a group or event a 15-17 child is in, when the child's parent asked for a yes for
-- new people (docs/ADR/0023 §5, PM decision on QA 5c F-2): not held (holding them would hold the
-- whole circle and tell it that someone 15-17 is in it), but the parents hear it. Runs as
-- bargu_owner.

-- The parents to tell, with their link: called as the newcomer, right after they came in.
CREATE FUNCTION app.guardians_watching(p_circle uuid) RETURNS TABLE (guardian_id uuid, link_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT l.guardian_id, l.id
      FROM app.circle_members m
      JOIN app.guardian_links l ON l.child_id = m.user_id AND l.status = 'active'
      JOIN app.circles c ON c.id = m.circle_id AND c.kind <> 'pair'
     WHERE m.circle_id = p_circle AND m.status = 'active'
       AND m.user_id <> app.current_user_id()
       AND l.guardian_id <> app.current_user_id()
       AND app.is_active_member(p_circle, app.current_user_id())
       AND app.needs_guardian_yes(m.user_id)
  $$;
REVOKE ALL ON FUNCTION app.guardians_watching(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardians_watching(uuid) TO bargu_app;
