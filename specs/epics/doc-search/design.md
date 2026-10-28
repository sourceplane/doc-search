# doc-search — design

## 1. The template

Supabase's Next.js OpenAI Doc Search Starter
([supabase-community/nextjs-openai-doc-search](https://github.com/supabase-community/nextjs-openai-doc-search),
Apache-2.0) is a Next.js 13.2 Pages Router app with one page and one API
route. The page (`pages/index.tsx`) opens a ⌘K dialog
(`components/SearchDialog.tsx`) whose question goes to
`pages/api/vector-search.ts`, an edge-runtime route that, with `OPENAI_KEY`:

1. sends the question to OpenAI's moderation endpoint and refuses a flagged
   one;
2. embeds it with `text-embedding-ada-002` (1536 dimensions);
3. calls `match_page_sections(embedding, 0.78, 10, 50)` over Supabase's Data
   API with the **service-role key** — an inner-product match over every
   section of every page;
4. fills a 1500-token context from the matches (counted with GPT-3's
   tokenizer), builds its prompt — answer only from the docs, in markdown,
   or say "Sorry, I don't know how to help with that." — and streams
   `gpt-3.5-turbo`'s answer (`OpenAIStream` from `ai` 2.x).

The docs are the site's own MDX files under `pages/docs` (one sample page on
OpenAI embeddings). `pnpm build` runs `pnpm run embeddings && next build`:
`lib/generate-embeddings.ts` walks `pages`, splits each MDX file into
sections by heading, hashes the file, and — holding `OPENAI_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` at build time — embeds and upserts every page
whose checksum changed (`--refresh` re-embeds all). Its schema is one
Supabase migration: `nods_page` and `nods_page_section` (a
`vector(1536)` column), row-level security with no policies, and the two
functions.

## 2. How it maps to Cloudflare and Supabase

| Upstream | Here | Why |
|---|---|---|
| Next.js 13.2 hosting, an edge-runtime API route | One Worker (`.open-next/worker.js`) + Static Assets, built by `@opennextjs/cloudflare` on Next.js 16.3.8. The page stays on the Pages Router; the search is an App Router route handler (`app/api/vector-search/route.ts`) | The adapter needs a supported Next.js; an edge-runtime route does not run under OpenNext, and a route handler keeps the route's Request/Response code as upstream wrote it |
| `OpenAIStream` / `StreamingTextResponse` (`ai` 2.x), `useCompletion` from `ai/react` | AI SDK 5: `streamText(...).toTextStreamResponse()`, `useCompletion` from `@ai-sdk/react` with `streamProtocol: 'text'` | The same plain-text stream to the same dialog; `ai` 2.x has no Workers AI provider |
| OpenAI for everything | Workers AI through the `AI` binding (§5); OpenAI optional, for the answer only | A product answers on its first deploy with no vendor key |
| supabase-js with the service-role key, `rpc('match_page_sections')` | SQL over the `HYPERDRIVE` binding, a `postgres` client per call (§3) | No service-role key exists for a product to hold |
| `supabase/migrations` applied with the Supabase CLI | `packages/db` + `infra/db-migrate` (§3) | One schema, applied in order before the Worker deploys, recorded in a ledger |
| The build embeds the docs | The build splits them; the deployed Worker embeds them (§4) | The build holds no credential |
| A Supabase project from the dashboard | `infra/terraform/supabase` (one project per environment) + `infra/terraform/cloudflare-hyperdrive` (one config per environment) | rag-chatbot's roots |
| "Deploy with Vercel" | `orun new --blueprint repo-blueprint.yaml` | |

## 3. The database

The app reaches the Supabase project's Postgres as `postgres` through a
Hyperdrive config, with SQL (`lib/db/index.ts`: `postgres` with
`prepare: false`, `fetch_types: false`, a client per call, ended in
`finally`). It never touches the Data API, so no service-role or anon key is
in the product.

- **`010_doc_search_init`** — upstream's migration byte for byte: the
  `vector` extension, both tables with row-level security and no policies,
  `get_page_parents()` and `match_page_sections()`.
- **`020_workers_ai_embeddings`** — refuses (and changes nothing) if the
  column already holds vectors of another size; resizes
  `nods_page_section.embedding` to `vector(768)`; recreates
  `match_page_sections()` with cosine similarity (`1 - (embedding <=> q)`,
  so the threshold reads as a similarity whatever the vectors' norms) and
  returns each section's `token_count`, which the route counts the context
  with instead of re-tokenising in the Worker.
- **`030_data_api_closed`** — revokes `EXECUTE` on both functions from
  `PUBLIC`, `anon` and `authenticated`. Row-level security already hid every
  row from those roles; the functions were still callable through the Data
  API's RPC, and nothing needs them there.

## 4. Where the docs are embedded

Upstream embeds at build time with two credentials in the build's
environment. Here the build must hold none, and the CI runner has no
Workers AI binding anyway. The Worker does: it has `AI` and `HYPERDRIVE`.
So the work splits in two.

- **The build** (`scripts/build-docs-index.ts`, first step of `pnpm build`)
  runs upstream's MDX processing (`lib/docs/process-mdx.ts`, upstream's code
  moved, not rewritten) over `pages/docs`, counts each section's tokens with
  upstream's tokenizer, and writes `lib/docs/index.generated.json`: every
  page's path, meta, checksum and sections. It is committed, so a fresh
  checkout typechecks and tests; `pnpm test` fails a stale one.
- **The Worker's `POST /api/embeddings`** (`lib/docs/sync.ts`) reads that
  index and, page by page, in ONE transaction per page under
  `pg_advisory_xact_lock(hashtext('nods_page:' || path))`: skips a page
  whose stored checksum matches (upstream's rule); otherwise upserts the page
  with a NULL checksum, deletes its old sections, embeds the new ones in one
  Workers AI call, inserts them, and sets the checksum last — so a failure
  rolls the page back whole and the next run retries it. `?refresh=1` is
  upstream's `--refresh`. A page that failed is named in the response, which
  is then a 500.
- **The deploy's smoke** POSTs it, then requires `/api/health` to report
  more than zero sections. Every deploy indexes what changed and nothing
  else; a redeploy with the same docs costs one SELECT per page.

The endpoint takes no credential: all it can do is embed the docs the Worker
was built with (risk DQ-E).

## 5. The models and the search

`lib/ai/models.ts`:

- **Embeddings — always Workers AI**, `@cf/baai/bge-base-en-v1.5`, 768
  dimensions, the column's size. The docs and the question must come from
  the same model, so no key switches this. BGE reads at most 512 tokens; a
  longer section is embedded from its first 2000 characters and stored
  whole.
- **The answer — Workers AI** `@cf/meta/llama-4-scout-17b-16e-instruct`,
  streamed. With `OPENAI_API_KEY` (a Worker secret), upstream's own: OpenAI's
  chat model (`OPENAI_MODEL`, default `gpt-3.5-turbo`) straight from OpenAI
  through `@ai-sdk/openai`, and upstream's moderation call first, because it
  is OpenAI's model the question reaches. No gateway.

`app/api/vector-search/route.ts` keeps upstream's steps, counts and prompt;
the threshold is `MATCH_THRESHOLD` (cosine, default 0.6 — upstream's 0.78
was ada-002's inner product, risk DQ-D). An index with no sections answers
200 with a sentence saying the docs are not indexed yet, never a 500. A
missing binding is a 503 naming it.

## 6. The repository

rag-chatbot's tree in the turso v8 shape: `apps/web` (the template),
`packages/db` (the migrations and Lumen's runner), `infra/terraform/supabase`,
`infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate`, `tests/web`,
`tests/db`, `tooling/*`; the baseline's own `blueprint.yaml`,
`repo-blueprint.yaml`, `.baseline/`, `hooks/`, `docs/phases/`, `testing/`
and `ai/context/`. `apps/web/wrangler.jsonc` is committed as the fixture's
render; the stage and prod lanes re-render it from the Hyperdrive wiring
document. Per environment, on a push to main: supabase →
cloudflare-hyperdrive → db-migrate → web, every edge enforced.

## Alternatives rejected

- **Embedding at `next build` in CI.** It needs a Workers AI credential and
  a database URL in the build, which is exactly what upstream did with its
  two keys and what this build must not do.
- **A separate indexing job in the pipeline** (a component that runs after
  the deploy). It would need the same two credentials on the runner; the
  deployed Worker already holds both bindings, and its smoke is the step
  that runs after the deploy.
- **Embedding on the first search.** The first visitor would pay for the
  whole doc set, and two visitors at once would race.
- **OpenAI embeddings when `OPENAI_API_KEY` is set.** ada-002's 1536
  dimensions cannot share the 768 column, and switching would orphan every
  stored vector.
- **Carrying upstream's `seed.sql`.** It holds ada-002 vectors.
- **Supabase's Data API with a service-role key.** A credential the product
  would have to hold for what Hyperdrive does as the tables' owner.
- **Moving the page to the App Router.** The page has no server data, and
  the template is a Pages Router app; only the route had to move.
