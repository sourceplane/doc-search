import type { MigrationManifest } from "./types.js";

// Every migration the runner applies, in order, with the sha256 of its file.
// `pnpm --filter @saas/db run manifest:check` verifies the checksums;
// `manifest:fix` rewrites them after a migration file changes (only ever
// before that migration has been applied anywhere — an applied migration's
// checksum is immutable).
export const manifest: MigrationManifest = {
  version: 1,
  migrations: [
    {
      id: "000_control_baseline",
      context: "control",
      path: "000_control/up.sql",
      checksum:
        "2a5d7f30684c99e3ff441ca8a2c38038dedd1bab4db4a40e92cd36bb22be297f",
      description:
        "Baseline control migration — creates the migration tracking schema",
    },
    {
      id: "010_doc_search_init",
      context: "app",
      path: "010_doc_search_init/up.sql",
      checksum:
        "178bbfc22fd0127bead5ef7fcac86e35a10cdac14b1423eac5c3a52777c99ade",
      description:
        "The doc search schema, verbatim from upstream supabase/migrations/20230406025118_init.sql: the vector extension, nods_page and nods_page_section (vector(1536)) with row-level security on both, match_page_sections() and get_page_parents()",
    },
    {
      id: "020_workers_ai_embeddings",
      context: "app",
      path: "020_workers_ai_embeddings/up.sql",
      checksum:
        "96c23426cd3264e224ba6b82294165987e4fdcb9a97add4faf726f96acb36935",
      description:
        "nods_page_section.embedding and match_page_sections() resized to vector(768), Workers AI's @cf/baai/bge-base-en-v1.5 (apps/web/lib/ai/models.ts); the function measures cosine similarity and returns each section's token_count; refuses while a row holds another model's vector",
    },
    {
      id: "030_data_api_closed",
      context: "app",
      path: "030_data_api_closed/up.sql",
      checksum:
        "e5088e8ba20c574323ae95e83976e313a039f973680debd1d15071e39787b8d6",
      description:
        "EXECUTE on match_page_sections() and get_page_parents() revoked from PUBLIC, anon and authenticated: closed to Supabase's Data API, open to the app, which owns them",
    },
  ],
};
