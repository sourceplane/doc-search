# doc-search — implementation plan

Three milestones, each one reviewed pull request (DQ0 is the repository's
first commit and its spec), each green before it merges.

## DQ0 — the spec (DQ-1)

The repository is born: `intent.yaml` with the placeholder workspace
`ws_CHANGE_ME`, `ci.yml` (byte for byte rag-chatbot's, which is
turso-starter's with the comment lines its own copy changes), the shared
TypeScript and ESLint configuration, the wiring renderer and migration
helpers, the spec index, this doc set and the task contracts.

## DQ1 — the doc search on Workers and Supabase (DQ-2)

- The template in `apps/web` on Next.js 16.3.8, the page on the Pages
  Router with upstream's UI pins: `pages/index.tsx` titled by `SITE_NAME`
  and linking `SOURCE_URL` (`lib/site.ts`), the unused Google font dropped;
  `components/SearchDialog.tsx` on `@ai-sdk/react`'s `useCompletion`, plain
  text stream.
- `app/api/vector-search/route.ts` (upstream's steps and prompt, the model
  from `lib/ai/models.ts`, the match over `lib/db`, the empty index
  answered), `app/api/embeddings/route.ts` and `lib/docs/sync.ts` (the
  Worker's indexing), `app/api/health/route.ts`.
- `lib/docs/process-mdx.ts` (upstream's MDX processing),
  `scripts/build-docs-index.ts` → `lib/docs/index.generated.json`, run first
  by `pnpm build`.
- `wrangler.template.jsonc` + `wiring.fixture.json` (the `HYPERDRIVE` and
  `AI` bindings), `component.yaml` (the smoke: the page, the index, the
  health check with sections).
- `packages/db`: `010_doc_search_init` (upstream's), `020_workers_ai_embeddings`,
  `030_data_api_closed`; the Supabase and Hyperdrive roots;
  `infra/db-migrate`.
- `tests/web` (the models on Workers AI and OpenAI, the sync's checksum
  skip, refresh, roll-back and lock, the routes over PGlite with pgvector,
  the docs index's freshness, the name seam, the Worker's config) and
  `tests/db` (the manifest, the schema at 768 dimensions, the cosine match,
  the revoke).

## DQ2 — a baseline (DQ-3)

rag-chatbot's machinery on this tree: `blueprint.yaml` (Cloudflare and
Supabase, five brokered keys, the subdomain read from the connection, no AI
key), `repo-blueprint.yaml` (01-product, then 02-docs), `.baseline/`, the
rename engine (upstream's repository and Vercel's template page masked: both
end in this baseline's slug), the bootstrap helpers, the deployment-record
renderer probing `/` and `/api/health` and recording how much of the docs is
indexed and which model answers, the phase pages, the context pack, and the
baseline's tests: manifest, phases, coverage, rebrand, retouch,
bootstrap-defer, the generated component docs, the leak gate, the offline
bootstrap with the product's own plan, and the end-to-end tier — the
migrations applied through a stand-in Supabase Management API over a real
Postgres with pgvector, the built Worker served over it with Workers AI
stood in for, the empty index asserted before the product's own smoke
indexes it, a second index embedding nothing, two at once embedding once, a
question answered from the matched section, and the Data API's roles shut
out of the rows and the functions.
