# doc-search — implementation status

| Milestone | State | Landed |
|---|---|---|
| DQ0 — the spec | ✅ | DQ-1 |
| DQ1 — the doc search on Workers and Supabase | ✅ | DQ-2 |
| DQ2 — a baseline | ✅ | DQ-3, tagged `baseline-v1` |

## Departures from the upstream template

Everything not listed here is the template as it is at `50d6bb7`.

| # | What | Why |
|---|---|---|
| 1 | Next.js 13.2.4 → 16.3.8 (React 18.2.0 and the UI packages at upstream's pins), ESLint in eslint-config-next 16's flat form with four rules off by name (DQ-H) | `@opennextjs/cloudflare` 1.20.11 needs a supported Next.js; `next lint` is gone in 16 |
| 2 | `pages/api/vector-search.ts` (edge runtime) → `app/api/vector-search/route.ts`, an App Router route handler beside the Pages Router page; upstream's steps, counts and prompt kept | An edge-runtime route does not run under OpenNext |
| 3 | `ai` 2.x (`OpenAIStream`, `StreamingTextResponse`, `ai/react`) → AI SDK 5 (`streamText(...).toTextStreamResponse()`, `@ai-sdk/react`'s `useCompletion` with `streamProtocol: 'text'`) | The same plain-text stream; 2.x has no Workers AI provider |
| 4 | The models: `lib/ai/models.ts` — Workers AI's `bge-base-en-v1.5` (768) for every embedding and Llama 4 Scout for the answer; `OPENAI_API_KEY` (was `OPENAI_KEY`, required) optional, switching only the answer to OpenAI (`OPENAI_MODEL`, default upstream's `gpt-3.5-turbo`) with upstream's moderation first | A product answers with no vendor key; no gateway; one embedding model for the docs and the question |
| 5 | supabase-js with `SUPABASE_SERVICE_ROLE_KEY` → SQL over the `HYPERDRIVE` binding, a `postgres` client per call (`lib/db`) | No service-role key in the product; the Workers runtime |
| 6 | `pnpm run embeddings` at build time (two credentials in the build) → the build writes `lib/docs/index.generated.json` with upstream's MDX processing (`lib/docs/process-mdx.ts`, moved) and the deployed Worker embeds it on `POST /api/embeddings`, which the deploy's smoke calls; upstream's checksum rule kept, in one transaction per page under an advisory lock; `--refresh` → `?refresh=1` | The build holds no credential (design.md §4) |
| 7 | `020_workers_ai_embeddings`: the column at `vector(768)`, `match_page_sections()` by cosine and returning `token_count`; `MATCH_THRESHOLD` (default 0.6) in place of the literal 0.78 (DQ-D) | BGE's vectors; a threshold that reads as a similarity; the context counted without a tokenizer in the Worker |
| 8 | `030_data_api_closed`: both functions revoked from `PUBLIC`, `anon` and `authenticated` | The Data API's RPC served them to every role |
| 9 | An empty index answers 200 with a sentence saying the docs are not indexed yet | Upstream answered "Sorry, I don't know…" from an empty context, indistinguishable from a miss |
| 10 | Sections embedded from their first 2000 characters (DQ-I) | BGE reads 512 tokens |
| 11 | `lib/site.ts`: `SITE_NAME` (the page title, upstream's "Next.js OpenAI Template") and `SOURCE_URL` — the header's GitHub link points at the product's own repository instead of `supabase/supabase` | One rename seam; the product's own source |
| 12 | `next/font/google`'s `Inter`, imported and never applied, removed | It fetched Google Fonts at build time and styled nothing |
| 13 | `supabase/seed.sql` not carried; `supabase/config.toml` dropped | The seed holds ada-002 vectors; the project is Terraform's |
| 14 | `app/api/health/route.ts` added | The deploy's smoke and the record's probe: reachable, migrated, how much is indexed |
| 15 | `next.config.js` → `next.config.mjs` (standalone output, the trace root, `images.unoptimized`, the dev platform proxy), `open-next.config.ts` and `wrangler.template.jsonc` added; `@types/unist` pinned at upstream's 2.0.6 | OpenNext's build; upstream's MDX types |

## Departures from the reference

| # | What | Why |
|---|---|---|
| 1 | No drizzle-kit (upstream has no ORM): the migrations live only in `packages/db` | rag-chatbot's twins were drizzle's |
| 2 | No chat and no tools: one streamed completion from matched sections; the knowledge base is the repository's MDX, indexed by every deploy, not resources added through a chat | The template |
| 3 | `OPENAI_API_KEY` in place of `AI_GATEWAY_API_KEY` | Upstream's own key, no gateway |
| 4 | The web smoke POSTs `/api/embeddings` and requires sections in `/api/health` | The deploy indexes the docs |
| 5 | The e2e asserts the empty index before the smoke, a second index embedding nothing, two concurrent indexes embedding once, and a question answered from a matched section | The template's own path |

## Verified

- `pnpm typecheck`, `lint`, `test` (tests/web 37, tests/db 11) and `build`
  green; the Worker is 1.80 MiB gzipped (Workers Free).
- Every contract tier, the leak gate and the placement tier pass locally on
  orun v2.89.0. The e2e tier needs a PostgreSQL server with pgvector
  (initdb, pg_ctl, psql), which this build's machine did not have: it ran on
  Baseline CI, where every pull request ran it before it merged. Its serving
  half — the routes through the real provider to the Workers AI stand-in,
  the sync's skip and lock — was run here against the built Worker over
  PGlite with pgvector.
