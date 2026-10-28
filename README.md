# doc-search

Supabase's [Next.js OpenAI Doc Search Starter](https://github.com/supabase-community/nextjs-openai-doc-search)
— a ⌘K dialog that answers a question about your docs: the MDX pages under
`pages/docs` split into sections by heading, each section embedded and
stored in Postgres with pgvector, the question embedded and matched against
them, and an answer streamed from the closest sections — running on
**Cloudflare Workers + Static Assets** through [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
embedding and answering with **Workers AI** through the Worker's `AI`
binding, its index a **Supabase** project's database reached through
**Cloudflare Hyperdrive**, both provisioned by Terraform through
[Orun](https://github.com/sourceplane/orun) and the schema applied by Orun's
`db-migrate`, the way the
[rag-chatbot baseline](https://github.com/sourceplane/rag-chatbot) does it, deployed by
[Orun](https://github.com/sourceplane/orun) to stage and prod on every merge.
Packaging it as an Orun baseline is the next milestone (DQ2).

The template's code is the code. What the port changes is what the Workers
runtime and a fresh, unattended deployment force: the database is reached
with SQL over the Hyperdrive binding (`lib/db/index.ts`) instead of through
Supabase's Data API with a service-role key; the models are Workers AI's
(`lib/ai/models.ts`) — the platform brokers no AI vendor, and the Cloudflare
account the app deploys into already is one — with upstream's OpenAI model
behind an optional key for the answers; and the docs are embedded by the
deployed Worker, not by the build. Upstream's `pnpm build` embedded every
changed page with OpenAI and wrote it through the Data API, with both keys
in the build; here the build only splits the docs into sections
(`lib/docs/index.generated.json`), and the deploy's smoke step POSTs
`/api/embeddings`, where the Worker embeds the pages whose checksum the
database does not hold through its own AI binding. The column and the search
function are sized to Workers AI's embedding model (768 dimensions, migration
`020_workers_ai_embeddings`). See [`specs/epics/doc-search`](specs/epics/doc-search/README.md)
for the design, the milestones and the as-built status, including every
departure.

## What is here (the product)

| Surface | Where |
|---|---|
| The product's name and source link | `apps/web/lib/site.ts` |
| The page and its search dialog | `apps/web/pages/index.tsx`, `apps/web/components/SearchDialog.tsx` |
| The docs the search answers from | `apps/web/pages/docs/**/*.mdx` |
| The search, the indexing, `/api/health` | `apps/web/app/api/{vector-search,embeddings,health}/route.ts` |
| The models: Workers AI, or OpenAI for the answers behind an optional key | `apps/web/lib/ai/models.ts` |
| The docs index (built) and the sync into Postgres (run by the Worker) | `apps/web/scripts/build-docs-index.ts` → `lib/docs/index.generated.json`, `lib/docs/process-mdx.ts`, `lib/docs/sync.ts` |
| The per-call database client | `apps/web/lib/db/index.ts` (`getSql()`) |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc` (committed), `component.yaml` |
| The schema as migrations, and Lumen's runner | `packages/db` (`@saas/db`) |
| The Supabase project, the Hyperdrive config, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (committed; this changes nothing)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # the docs index + next build + opennextjs-cloudflare build → apps/web/.open-next
pnpm --filter @saas/db run manifest:check
```

The build needs no database, no model and no Cloudflare credential. Running
it locally — a Postgres with pgvector on `localhost:5432` with the
migrations applied, `wrangler login` for Workers AI, `next dev` or `wrangler
dev`, then `POST /api/embeddings` to index the docs — is in the product's
README (`.baseline/product/README.md`), which is what a product built from
here carries.

## How it maps to Vercel

| Vercel | Here |
|---|---|
| Next.js hosting (an edge-runtime API route streams the answer) | One Cloudflare Worker (`.open-next/worker.js`) + Static Assets; the page stays on the Pages Router and the route is an App Router route handler (an edge-runtime route does not run under OpenNext), streaming plain text as it did |
| OpenAI for everything, `OPENAI_KEY` required: `text-embedding-ada-002` (1536 dimensions), `gpt-3.5-turbo`, the moderation endpoint | Workers AI through the `AI` binding: `@cf/baai/bge-base-en-v1.5` (768 dimensions) for the docs and the question, `@cf/meta/llama-4-scout-17b-16e-instruct` for the answer, no key. `OPENAI_API_KEY`, if set, switches the answer — not the embeddings — to upstream's OpenAI model, straight from OpenAI, with upstream's moderation step first. No AI gateway |
| Supabase's Data API with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` | The Supabase project's Postgres through a Hyperdrive config, with SQL; no service-role key exists, and the Data API is shut out of both tables (upstream's row-level security) and both functions (migration `030`) |
| `pnpm run embeddings && next build`: the build embeds every changed page and upserts it | The build splits the docs (`lib/docs/index.generated.json`, no credential); the deploy's smoke POSTs `/api/embeddings` and the Worker embeds the changed pages and writes them, checksum by checksum as upstream did |
| `supabase/migrations` applied with the Supabase CLI | `packages/db` + `infra/db-migrate`: upstream's migration verbatim, then the resize to 768 dimensions with a cosine `match_page_sections()`, applied through Supabase's Management API after the project and the Hyperdrive config exist, before the Worker deploys |
| A Supabase project created in the dashboard | `infra/terraform/supabase` (one project per environment) + `infra/terraform/cloudflare-hyperdrive` (one config per environment), ids and credentials as orun secrets |
| "Deploy with Vercel" (clone the template) | `orun new --blueprint repo-blueprint.yaml` — a new repository, branded, provisioned, deployed, indexed |

## CI

| Workflow | What it runs | Ships to a product |
|---|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow a product carries: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes (the app built and dry-deployed per environment, both Terraform roots checked and planned, the migrations planned); no lane runs the `typecheck`, `lint` or `test` scripts — `baseline.yml`'s e2e tier runs them on the bootstrapped product before every tag, and a product's developers run them before they push. The bootstrap's own landings (`orun/BASE-*`) run `plan` alone and nothing waits for it — the landing was checked in the build box; a merge applies, migrates and deploys stage → prod. It plans nothing while `intent.yaml` names the placeholder workspace `ws_CHANGE_ME`, as this repository does. A manual run (Orunbase's Deploy button, or Run workflow on `main`) plans the environment and components it names under the push-to-main trigger, so they deploy as a merge deploys them | yes |
