# doc-search

Supabase's [Next.js OpenAI Doc Search Starter](https://github.com/supabase-community/nextjs-openai-doc-search)
— a ⌘K dialog that answers questions about your docs: the MDX pages under
`apps/web/pages/docs` split into sections by heading, each section embedded
and stored in Postgres with pgvector, the question embedded and matched
against them, and an answer streamed from the closest sections — on
**Cloudflare Workers + Static Assets** through
[`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare). The models are
**Workers AI**'s, through the Worker's `AI` binding, so it needs no AI vendor
key; the index is a **Supabase** project's Postgres reached through
**Cloudflare Hyperdrive**. Terraform provisions both per environment, Orun's
`db-migrate` applies the schema, and every deploy indexes the docs it ships
with — all on every merge to `main`.

## Live deployment

<!-- 02-docs:begin -->
Not recorded yet. The bootstrap's last phase writes the live URLs, the
workspace, how much of the docs is indexed, the model the answers come from
and the secrets the product uses into
[ai/context/deployment.md](ai/context/deployment.md); how the product deploys
and how to operate it is in
[ai/context/operations.md](ai/context/operations.md).
<!-- 02-docs:end -->

## What is here

| Surface | Where |
|---|---|
| The product's name and source link | `apps/web/lib/site.ts` |
| The page and its search dialog | `apps/web/pages/index.tsx`, `apps/web/components/SearchDialog.tsx` |
| **Your docs** — what the search answers from | `apps/web/pages/docs/**/*.mdx` |
| The search (`POST /api/vector-search`) | `apps/web/app/api/vector-search/route.ts`, `apps/web/lib/search.ts` |
| The indexing (`POST /api/embeddings`) | `apps/web/app/api/embeddings/route.ts`, `apps/web/lib/docs/sync.ts` |
| The docs index the build writes | `apps/web/scripts/build-docs-index.ts` → `apps/web/lib/docs/index.generated.json` |
| The models — Workers AI by default, OpenAI for the answers if you add its key | `apps/web/lib/ai/models.ts` |
| The per-call database client | `apps/web/lib/db/index.ts` |
| The database check the deploy smoke-tests | `apps/web/app/api/health/route.ts` |
| Workers build and deploy contract | `apps/web/next.config.mjs`, `open-next.config.ts`, `wrangler.template.jsonc` → `wrangler.jsonc`, `component.yaml` |
| The schema as migrations, and their runner | `packages/db` (`@saas/db`) |
| The Supabase project, the Hyperdrive config, the migration step | `infra/terraform/supabase`, `infra/terraform/cloudflare-hyperdrive`, `infra/db-migrate` |
| Tests | `tests/web`, `tests/db` (vitest) |

## Getting started

```bash
pnpm install
pnpm run wire:fixture   # re-render apps/web/wrangler.jsonc from its template (it is committed)
pnpm typecheck
pnpm lint
pnpm test
pnpm build              # the docs index + next build + opennextjs-cloudflare build → apps/web/.open-next
```

The build needs no database, no model and no credential: it reads
`pages/docs` and splits it into sections, nothing more. The tests run the
three routes, the sync and the search SQL over a real Postgres with pgvector
in process, and the real AI SDK and Workers AI provider against a scripted
binding.

## Your docs

The docs are `apps/web/pages/docs/**/*.mdx` — the template ships one sample
page. They are not pages of the site (Next.js renders no MDX here, as
upstream): they are what the search answers from. Add, edit or remove files,
then:

```bash
pnpm --filter @app/web docs:index   # rewrite lib/docs/index.generated.json
```

and commit both. The build rewrites the index anyway, and `pnpm test` fails
if the committed one is stale. Merge, and the deploy indexes what changed:
its smoke step POSTs `/api/embeddings`, and the Worker embeds every page
whose checksum the database does not already hold — an unchanged page costs
one SELECT and no embedding. A page removed from the docs stays in the index
until you delete it (as upstream):

```sql
delete from nods_page where path = '/docs/<the page>';
```

Each section is embedded from its first 2,000 characters (Workers AI's BGE
reads 512 tokens at most); the whole section still goes to the answer.

## Running it locally

You need a Postgres with the `vector` extension available, and a Cloudflare
login for the models.

1. **A Postgres with pgvector** on `localhost:5432`, database `docs`, user and
   password `postgres` — the `localConnectionString` in
   `apps/web/wrangler.template.jsonc`. Docker is the quickest:

   ```bash
   docker run --name docs-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=docs -p 5432:5432 -d pgvector/pgvector:pg17
   ```

   The [Supabase CLI](https://supabase.com/docs/guides/local-development)
   (`supabase start`) works too — its Postgres ships pgvector; point the
   connection string at its port.

2. **Schema.** Apply `packages/db/src/migrations/*/up.sql` in order —
   upstream's schema, the resize to 768 dimensions, the functions closed to
   the Data API:

   ```bash
   for f in packages/db/src/migrations/*/up.sql; do psql postgres://postgres:postgres@localhost:5432/docs -v ON_ERROR_STOP=1 -f "$f"; done
   ```

   CI applies the same files to the real databases, through `infra/db-migrate`.

3. **Models.** Workers AI has no local mode: the `AI` binding always reaches
   your Cloudflare account, so `wrangler login` once. That is all — no key.

4. **Run.** Either Next's dev server, which gets the Worker's bindings
   through `getCloudflareContext()`:

   ```bash
   pnpm --filter @app/web dev          # http://localhost:3000
   ```

   or the built Worker under `wrangler dev`, which reads
   `apps/web/.dev.vars` (copy `.dev.vars.example`; every key is optional):

   ```bash
   pnpm build
   pnpm --filter @app/web preview      # http://localhost:8787
   ```

5. **Index the docs**, as the deploy does:

   ```bash
   curl -X POST http://localhost:3000/api/embeddings
   ```

Press ⌘K and ask a question about the docs. Before they are indexed, the
dialog says so; with no `AI` binding, the search answers 503 with the reason.

## How it deploys

Merges to `main` converge through [Orun](https://github.com/sourceplane/orun):
`.github/workflows/ci.yml` plans the changed components and runs each lane
against the workspace in `intent.yaml`. Per environment the order is
enforced — **the Supabase project, then the Hyperdrive config over its
database, then the migrations, then the Worker** — because each reads what
the one before it published: the project's ref and password, the Hyperdrive
id the Worker binds, the schema the app queries. `stage` deploys first and
`prod` once stage has converged on the same commit; `dev` only verifies.
Every deploy is smoke-tested over HTTP: the page renders, `POST
/api/embeddings` indexes the docs the Worker was built with (and must store
every page), and `/api/health` answers ok with sections in the index — which
it does only when the Worker reaches a migrated database.

The pipeline holds one credential, GitHub's own `GITHUB_TOKEN`. The
Cloudflare tokens and account id and the Supabase access token and org id
are brokered per run from the workspace's connections; the Supabase
project's credentials and the Hyperdrive id are published by the Terraform
applies as orun secrets. Workers AI needs nothing: the `AI` binding is the
account the Worker deploys into, billed to it after its free daily
allocation. Nothing provider-shaped is stored in the repository or in
GitHub.

**Deploy by hand.** Orunbase's **Deploy** button on a component, or **Run
workflow** on the CI workflow in GitHub's Actions tab (on `main`), runs
`ci.yml` for the environment and components you pick, and each one deploys
exactly as a merge would deploy it. Leave the component blank to redeploy
every component in that environment, with nothing changed: after rotating a
secret, say. A component with nothing to run in that environment (a test
suite in `prod`) is left out with a notice.

## Use OpenAI for the answers

The answers come from Workers AI (`@cf/meta/llama-4-scout-17b-16e-instruct`)
unless the environment's Worker has an `OPENAI_API_KEY`. With one, they come
from OpenAI's `gpt-3.5-turbo` — the model the upstream template shipped with
— straight from OpenAI, and every question first goes through OpenAI's
moderation endpoint, as upstream did. Per environment:

```bash
wrangler secret put OPENAI_API_KEY --name doc-search-web-prod
wrangler secret put OPENAI_API_KEY --name doc-search-web-stage
```

Worker secrets survive every later deploy; the next request sees them, and
`/api/health` reports `"answers":"openai"`. A Worker var `OPENAI_MODEL` picks
another OpenAI chat model. Locally, put the key in `apps/web/.dev.vars` (or
`.env.local` for `next dev`).

The embeddings stay on Workers AI (`@cf/baai/bge-base-en-v1.5`) either way:
the index's column is sized to that model's 768 dimensions, and a question
embedded by one model cannot be compared with docs embedded by another.
Changing the embedding model is a migration plus re-indexing every page
(`POST /api/embeddings?refresh=1`, below); `ai/context/operations.md` says
how.

## Re-embedding every page

`POST /api/embeddings` — what every deploy's smoke calls — needs nothing:
it embeds only the pages whose checksum the database does not hold, so a
call with unchanged docs embeds nothing, and two at once embed a page once.
Its `?refresh=1` (upstream's `--refresh`) embeds EVERY page again, billed
to your Workers AI, so it needs a bearer: the environment's
`REINDEX_TOKEN`. Without one stored, refresh answers 403 and embeds
nothing — which is how a new product starts.

1. **Store a token**, once per environment, as this repository's Orun
   secret (stage and prod can each hold their own):

   ```bash
   openssl rand -hex 32                          # a token; keep it
   orun secrets set REINDEX_TOKEN --env stage    # prompts for the value
   orun secrets set REINDEX_TOKEN --env prod
   ```

   The build never sees it: the deploy hands it to the Worker as a Worker
   secret (`wrangler secret bulk`), so it is in no bundle and no log.
2. **Redeploy the app** (storing a secret deploys nothing): Orunbase's
   Deploy button, or `gh workflow run ci.yml --ref main -f environment=<env>
   -f component=web`.
3. **Refresh**:

   ```bash
   curl -X POST -H "Authorization: Bearer <token>" \
     https://doc-search-web-<env>.<your-subdomain>.workers.dev/api/embeddings?refresh=1
   ```

   A missing or wrong bearer gets 403 and embeds nothing.

To turn refresh off again, delete the Orun secret and the Worker secret
(`pnpm exec wrangler secret delete REINDEX_TOKEN --name doc-search-web-<env>`
from `apps/web`): a deploy pushes the secrets that exist and deletes none.

## Tuning the search

A section reaches the answer when its cosine similarity to the question is
above `MATCH_THRESHOLD` — `0.6` by default, set for Workers AI's BGE base
(upstream's `0.78` was set for OpenAI's ada-002, whose scores sit closer
together). Too many unrelated sections in the answers: raise it. Real
questions answered "Sorry, I don't know": lower it. Set it per environment
as a Worker secret — not because it is secret, but because a secret survives
every later deploy, where a variable set in the dashboard is replaced by the
next one:

```bash
wrangler secret put MATCH_THRESHOLD --name doc-search-web-prod   # then type 0.5
```

The search reads it on the next request (`apps/web/lib/search.ts`).

## Custom domain

The app answers on workers.dev from its first deploy. To serve it on your
own domain, attach the domain to the Worker in Cloudflare (Workers & Pages →
`doc-search-web-prod` → Settings → Domains & Routes). Nothing in the build
names the origin — the page renders no absolute URL — so nothing else has to
change.

The repository names the domain in one place, `BASE_DOMAIN` in
`intent.yaml` (one line per environment), which the product was born with as
the reserved placeholder `doc-search.example.com`. Replace it with your
domain when you have one.

## CI

| Workflow | What it runs |
|---|---|
| `ci.yml` | the Orun pipeline, and the only workflow: `orun plan --changed`, then one job per lane. A pull request runs the verify lanes — the app built and dry-deployed for each environment, both Terraform roots checked and planned, the migrations planned — with nothing applied or deployed. No lane runs the `typecheck`, `lint` or `test` scripts: run them yourself (above) before you push. A merge applies, migrates, deploys and indexes stage → prod |

## Credits

The app is Supabase's
[Next.js OpenAI Doc Search Starter](https://github.com/supabase-community/nextjs-openai-doc-search)
(Apache-2.0 — `apps/web/LICENSE`), which Vercel lists at
https://vercel.com/templates/next.js/nextjs-openai-doc-search-starter.
