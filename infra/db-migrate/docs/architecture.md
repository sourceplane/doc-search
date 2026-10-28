# db-migrate — architecture

Applies the migrations under `packages/db/src/migrations` in order, recording each one
it applies so a run only ever applies what is new. An already-applied migration
is never edited: a change is a new, later migration.

## Migrations

- `000_control`
- `010_doc_search_init`
- `020_workers_ai_embeddings`
- `030_data_api_closed`

## Resolved at run time (names only)

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_DB_URL`
- `SUPABASE_PROJECT_REF`
