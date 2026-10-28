# doc-search — decisions

The choices that shape this repository, one line each, with where the full
reasoning lives.

| # | Decision | Why | Source |
|---|---|---|---|
| 1 | OpenNext on Workers + Static Assets, the static-assets incremental cache; the page stays on the Pages Router and the API route becomes an App Router route handler | The page has no server data and pre-renders; an edge-runtime route does not run under OpenNext, and a route handler keeps the handler's Request/Response code as upstream wrote it | `specs/epics/doc-search/design.md` §2 |
| 2 | The database is reached with SQL over the `HYPERDRIVE` binding, a `postgres` client per call; no Supabase Data API, no service-role key | Workers refuse a socket opened in another request; a service-role key is a credential the product would have to hold, and Hyperdrive reaches the same Postgres as its owner | design.md §3 |
| 3 | The docs are embedded by the deployed Worker, triggered by the deploy's smoke (`POST /api/embeddings`), not by the build | Upstream's build held OPENAI_KEY and SUPABASE_SERVICE_ROLE_KEY; here the build holds no credential, and the Worker already has the AI and HYPERDRIVE bindings | design.md §4, risk DQ-C |
| 4 | The build writes a committed docs index (`lib/docs/index.generated.json`) with upstream's MDX processing; the Worker never parses MDX | Typecheck and the tests need it in a fresh checkout; `pnpm test` fails a stale one and `pnpm build` rewrites it | design.md §4 |
| 5 | The sync keeps upstream's per-page checksum rule, inside one transaction per page with an advisory lock on its path | A second deploy (or a retry) embeds nothing; a failure rolls the page back whole; two syncs at once embed a page once | design.md §4 |
| 6 | Workers AI through an `AI` binding for both models (BGE base at 768 dimensions, Llama 4 Scout streamed); `OPENAI_API_KEY` is optional and switches only the answer, straight from OpenAI, with upstream's moderation | The platform brokers no AI vendor and no AI gateway; a key that switched the embeddings would orphan every stored vector | design.md §5, risk DQ-A |
| 7 | `010_doc_search_init` is upstream's migration byte for byte; `020` resizes the column and the function to 768, measures cosine and returns token counts; `030` closes both functions to the Data API | Migrations are immutable once applied; BGE's vectors are not ada-002's; upstream's functions were executable by every role | IMPLEMENTATION-STATUS |
| 8 | The search threshold is `MATCH_THRESHOLD` (cosine, default 0.6), overridable per environment | Upstream's 0.78 was ada-002's; the right value depends on the model and the docs | design.md §5, risk DQ-D |
| 9 | `apps/web/wrangler.jsonc` is committed as the fixture render; the stage and prod lanes re-render it from the Hyperdrive wiring document | The composition checks the file exists before the build | design.md §6 |
| 10 | One landing (`01-product`) then the record (`02-docs`); one convergence runs supabase → cloudflare-hyperdrive → db-migrate → web, enforced on `main`, advisory on a pull request | A job resolves its secrets when it starts, so each apply must finish before its reader | `repo-blueprint.yaml` |
| 11 | rag-chatbot's machinery on the turso-starter v8 shape at orun v2.88.0: `ci.yml` alone in a product, the subdomain read from the Cloudflare connection, no domain asked, generated component docs | The reference's shape, byte for byte where it can be | IMPLEMENTATION-STATUS |
