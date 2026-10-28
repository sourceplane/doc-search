-- Supabase's Data API (PostgREST) serves `public` to anyone holding the
-- project's anon key, which is public by Supabase's design. Upstream's init
-- (010) already enabled row-level security, with no policies, on both of its
-- tables, so `anon` and `authenticated` read and write no row of them. Its
-- two functions, though, are callable through the Data API's RPC by every
-- role (a function is executable by PUBLIC unless revoked, and Supabase grants
-- EXECUTE in `public` to anon and authenticated by default). They run as the
-- caller, so row-level security still hides every row from those roles — but
-- the app never calls them through the Data API (it reaches Postgres through
-- Hyperdrive as `postgres`, which owns them), so nothing needs them open.
-- Close them. Idempotent: revoking a privilege nobody holds is a no-op.
REVOKE EXECUTE ON FUNCTION match_page_sections(vector, float, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION get_page_parents(bigint) FROM PUBLIC;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION match_page_sections(vector, float, int, int) FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION get_page_parents(bigint) FROM %I', r);
    END IF;
  END LOOP;
END
$$;
