# doc-search — operating contract (for humans and agents)

This is the standing guide to how this product is deployed and operated.
Instance facts (live URLs, workspace, how much of the docs is indexed,
which model writes the answers, the secrets it uses) live in [deployment.md](deployment.md), rendered from
probed reality by the bootstrap's `02-docs` phase; this file is the contract
that stays true between deployments. It is written to give an agent with
repository read access enough context to reason about and operate the product
without any other source.

## What this system is

Supabase's Next.js OpenAI Doc Search Starter — a ⌘K dialog that answers
questions about the docs in `apps/web/pages/docs/**/*.mdx`: the docs split
into sections by heading, each section embedded and stored in Postgres with
pgvector, a question embedded and matched against them by cosine similarity,
and an answer streamed from the closest sections — on Cloudflare Workers.
Its models are **Workers AI's**, through the Worker's `AI` binding:
`@cf/baai/bge-base-en-v1.5` (768 dimensions) for the docs and the question,
`@cf/meta/llama-4-scout-17b-16e-instruct` for the answer
(`apps/web/lib/ai/models.ts`). Its index is a Supabase project's Postgres
with pgvector, reached through Cloudflare Hyperdrive. Expressed as an Orun
component-native desired-state repo. Seven components:

- **`infra/terraform/supabase`** (`supabase`) — one Supabase project per
  environment. Its apply publishes `SUPABASE_PROJECT_REF`,
  `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` onto the environment's secret
  rung.
- **`infra/terraform/cloudflare-hyperdrive`** (`cloudflare-hyperdrive`) — one
  Hyperdrive config per environment over that database. Its apply publishes
  `WIRING_CLOUDFLARE_HYPERDRIVE` (the config's id and name).
- **`infra/db-migrate`** (`db-migrate`) — applies `packages/db`'s migrations
  to the environment's database through Supabase's Management API: the
  `vector` extension and upstream's schema — `nods_page`, `nods_page_section`
  (now `vector(768)`), row-level security on both, `match_page_sections()`
  (now cosine, returning each section's token count) — and both functions
  closed to the Data API. Each migration is recorded with its
  checksum in `_migrations.applied`; only the missing ones apply.
- **`packages/db`** (`db`) — the migrations and their runner.
- **`apps/web`** (`web`) — the app: Next.js built by `@opennextjs/cloudflare`
  into one Worker plus Static Assets. It reaches Postgres through its
  `HYPERDRIVE` binding, one client per call (`lib/db/index.ts`), and its
  models through its `AI` binding. Three routes: `POST /api/vector-search`
  (the search, streamed), `POST /api/embeddings` (the indexing: the docs
  this Worker was built with, embedded and written page by page, skipping
  every page whose checksum the database holds) and `GET /api/health`.
- **`tests/web`**, **`tests/db`** — vitest suites, verified on the `dev` rung.

Environments: **`stage`** and **`prod`** are deployed; **`dev` is
verify-only by design** — lanes build and test, nothing deploys.

## Identity and tenancy

Every remote operation runs against ONE Orun workspace, declared in
`intent.yaml` under `execution.state.workspace` — committed, enforced, and
what CI uses. Do not remove it; headless credentials depend on it. If it
reads `ws_SET_ME`, the bootstrap had no workspace to write: set the real one
before anything else.

## How deployment works

1. Merge (or push) to `main`.
2. CI (`.github/workflows/ci.yml`) runs `orun plan --changed` — only
   components whose files changed are planned — then runs each planned lane
   with `orun run --remote-state`, authenticated by GitHub OIDC (the
   exchange resolves this repository's linked workspace server-side).
3. Per environment, in this order — each edge `mode: enforced` on a push to
   main, advisory on a pull request (which deploys nothing):
   **`supabase` → `cloudflare-hyperdrive` → `db-migrate` → `web`.** A job
   resolves its secrets when it starts, so each one reads what the apply
   before it published. The app's deploy re-renders `apps/web/wrangler.jsonc`
   from `WIRING_CLOUDFLARE_HYPERDRIVE` before it builds, deploys
   `doc-search-web-<env>`, and smoke-tests it — which is also where the
   docs are indexed: the page renders; `POST /api/embeddings` embeds the
   docs the Worker was built with through Workers AI and writes them through
   Hyperdrive (only the pages that changed), answering `"ok":true` only if
   every page stored; and `/api/health` answers 200 with sections in the
   index — only when the database is reachable through Hyperdrive and
   migrated (the embedding column at 768 dimensions). No answer model is
   called.
4. `prod` deploys after `stage` has converged on the same commit
   (`environments.prod.promotion` in intent.yaml).
5. **The convergence run is the deployment.** A green run means every
   planned lane applied. Failed lanes are retried with
   `gh run rerun --failed`, which resumes the same execution.

Caveats that matter:

- A push that touches no component files plans zero lanes — that run is
  green and deployed nothing. Never treat "latest run green" as "product
  converged"; probe the URLs instead.
- `apps/web/wrangler.jsonc` is committed as the render of
  `wrangler.template.jsonc` from `wiring.fixture.json` (a placeholder
  Hyperdrive id): edit the template and run `pnpm run wire:fixture`. The
  deploy lanes render the real one in their own job tree; never commit a
  real id.
- **The docs index is built, then embedded by the deploy.** `pnpm build`
  writes `apps/web/lib/docs/index.generated.json` from `pages/docs` (no
  credential); the deploy's smoke embeds it. The index is committed: after
  changing the docs, run `pnpm --filter @app/web docs:index` and commit it
  (`pnpm test` fails a stale one). A page removed from the docs stays in the
  database until deleted (`delete from nods_page where path = '…'`), as
  upstream.
- **The embedding model and the column are one decision.**
  `nods_page_section.embedding` is `vector(768)` because
  `@cf/baai/bge-base-en-v1.5` is 768-dimensional. Changing the model means a
  new migration that resizes the column and the function, AND re-indexing
  every page (`POST /api/embeddings?refresh=1` with the environment's
  `REINDEX_TOKEN` as a bearer — README, "Re-embedding every page"): vectors from two models
  share no space, even at the same size. Changing the ANSWER model is a
  one-line change in `lib/ai/models.ts`, with no migration.
- **How strict the search is** is `MATCH_THRESHOLD` (cosine similarity,
  default 0.6 in `apps/web/lib/search.ts`), set per environment as a Worker
  secret so it survives deploys.
- Both tables in `public` have row-level security and no policy (upstream's
  own), and both functions are closed to `anon` and `authenticated`
  (migration 030). Supabase's Data API serves `public` to the anon key, so
  this is what keeps the index out of it; the app is unaffected because it
  connects as `postgres`, the owner. Give a new table row-level security;
  never `FORCE` it, and never add a policy for `anon` without meaning to
  publish that table.
- A migration is immutable once applied: its checksum is in
  `packages/db/src/manifest.ts` and in the database's ledger. Change the
  schema with a NEW migration in `packages/db/src/migrations`.

## Secrets model

- **Brokered provider secrets**, minted per run from the workspace's
  connections — no long-lived values at rest, nothing to rotate by hand:
  `CLOUDFLARE_API_TOKEN` (Workers deploy, the AI binding included),
  `CLOUDFLARE_HYPERDRIVE_TOKEN` (Hyperdrive — the deploy token deliberately
  cannot touch it), `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN` (project
  create and migrations) and `SUPABASE_ORG_ID`.
- **Published by the applies** onto the stage and prod rungs:
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL`,
  `WIRING_CLOUDFLARE_HYPERDRIVE`.
- **No model key.** Workers AI is the Cloudflare account the Worker runs in;
  it bills that account after its free daily allocation.
- **Optional, the owner's:** `OPENAI_API_KEY`, a Worker secret, switches
  the answers to OpenAI's model (below), and `MATCH_THRESHOLD` tunes the
  search. No platform brokers either.
- Inspect by NAME only: `orun secrets list --org <ws> --project` and
  `--env stage|prod`. No tooling in this repository prints a secret value,
  and no document in `ai/context/` may contain one.

## Use OpenAI for the answers

The answers come from Workers AI unless the environment's Worker has an
`OPENAI_API_KEY`. With one, they come from OpenAI's `gpt-3.5-turbo` (or the
Worker var `OPENAI_MODEL`) — the model the upstream template shipped with —
straight from OpenAI, and each question goes through OpenAI's moderation
endpoint first, as upstream did. Per environment (`stage`, `prod`):

```bash
wrangler secret put OPENAI_API_KEY --name doc-search-web-<env>
```

Worker secrets survive every later deploy; nothing in CI touches them. The
next request is answered by OpenAI, and `/api/health` reports
`"answers":"openai"`. To go back, `wrangler secret delete OPENAI_API_KEY
--name doc-search-web-<env>`. **Embeddings stay on Workers AI either way**:
the index's column is sized to its model. Re-running the bootstrap's
`02-docs` phase records the change in [deployment.md](deployment.md).

## Verifying the system

```bash
# the app and its database path on each environment (also recorded, probed, in deployment.md)
curl -s -o /dev/null -w '%{http_code}\n' https://doc-search-web-stage.your-workers-subdomain.workers.dev/
curl -s https://doc-search-web-prod.your-workers-subdomain.workers.dev/api/health

# the index (pages, sections) and the answer model, without calling a model
curl -s https://doc-search-web-stage.your-workers-subdomain.workers.dev/api/health
# index now (what every deploy's smoke does), then ask — the dialog does the same
curl -s -X POST https://doc-search-web-stage.your-workers-subdomain.workers.dev/api/embeddings
curl -s -X POST -H 'content-type: application/json' -d '{"prompt":"What is pgvector?"}' \
  https://doc-search-web-stage.your-workers-subdomain.workers.dev/api/vector-search

# workspace readiness (integrations + repository link)
orun integrations list --org <ws> --json && orun cloud check --org <ws>
```

## Common operations

| task | how |
|---|---|
| deploy a change | merge to `main`; watch the run; failed lanes → `gh run rerun --failed` |
| deploy by hand | Orunbase's Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env> [-f component=<a,b>]` — the named components (blank: every one) run in that environment as a merge runs them; started off `main` it is refused |
| change the docs | edit `apps/web/pages/docs/**/*.mdx`, `pnpm --filter @app/web docs:index`, commit both, merge — the deploy embeds the pages that changed |
| index now | `curl -X POST https://doc-search-web-<env>.…workers.dev/api/embeddings` (open and idempotent: unchanged pages embed nothing). `?refresh=1` embeds every page again and needs `-H "Authorization: Bearer $REINDEX_TOKEN"`, the environment's Orun secret (README, "Re-embedding every page"); without it, 403 |
| change the schema | a new `packages/db/src/migrations/<nnn>_<name>/up.sql` and its manifest entry (`pnpm --filter @saas/db run manifest:fix` for its checksum), merge — db-migrate applies it before the app deploys. Keep row-level security on every table in `public` |
| change the answer model | `WORKERS_AI_CHAT_MODEL` in `apps/web/lib/ai/models.ts` |
| change the embedding model | a new migration resizing `nods_page_section.embedding` and `match_page_sections()`, `WORKERS_AI_EMBEDDING_MODEL` and `EMBEDDING_DIMENSIONS` in `lib/ai/models.ts`, then `POST /api/embeddings?refresh=1` with the bearer, per environment |
| tune the search | `wrangler secret put MATCH_THRESHOLD --name doc-search-web-<env>` (cosine similarity; default 0.6) |
| redeploy without a change | edit the last line of the component's `component.yaml` (`# orun: redeploy <reason> <stamp>`) and merge — it is a deploy trigger, nothing reads it |
| use OpenAI for the answers | above |
| serve a custom domain | attach it to the Worker in Cloudflare (nothing in the build names the origin), and replace the placeholder `doc-search.example.com` in `intent.yaml`'s `BASE_DOMAIN` with the domain |
| headless credentials | `ORUN_TOKEN` (workspace-scoped) + `GITHUB_TOKEN` |

The deployment record is the bootstrap's `02-docs` phase. Re-running it (the
Orun console's Retry on that phase, or `orun new … --phase 02-docs`)
re-probes the URLs and re-renders [deployment.md](deployment.md); it is
idempotent.

## Evolution

Structural changes (a second Worker, a queue, another data store) follow the
same contract that deployed the product: add a component under `apps/`,
`infra/` or `packages/` with a `component.yaml` — declaring `dependsOn` on
any infrastructure whose published secrets it reads, enforced on main — land
it as a pull request, and the convergence run applies it.
