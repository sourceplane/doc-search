# 01-product — the product, in one landing

The whole product lands as ONE pull request, and ONE convergence on main
provisions and deploys it on stage and prod: the Supabase project, the
Hyperdrive config over its database, the migrations, and the app — in that
order, per environment.

**Places** every module `repo-blueprint.yaml` declares: the root manifests,
CI, tooling and identity; `infra/terraform/supabase`,
`infra/terraform/cloudflare-hyperdrive` and `infra/db-migrate`;
`packages/db` (the migrations and their runner); `apps/web`; and
`tests/web`, `tests/db`. `testing/phases.test.sh` holds the set.

**Requires** three live connections, probed and waited for (up to ten
minutes, so a consent can be clicked while it waits): the GitHub App on the
account that OWNS the repository — the platform sees a PR only through that
installation — and Cloudflare and Supabase, which every credential below is
minted from.

## How one convergence keeps the order

| what has to come first | how the plan holds it |
|---|---|
| the Supabase project before Hyperdrive | `cloudflare-hyperdrive` reads `SUPABASE_PROJECT_REF` and `SUPABASE_DB_PASSWORD`, which the `supabase` apply lease-publishes, and declares `dependsOn: supabase`, `mode: enforced` on main. A job resolves its secrets when it STARTS, so the values are there |
| the migrations after the project — and after Hyperdrive | `db-migrate` reads the project's three credentials and declares `dependsOn` on `supabase` and `cloudflare-hyperdrive`, enforced on main. Nothing in it needs Hyperdrive: a migration is the one step a re-run cannot take back, so it runs only once everything else the app needs exists, right before the app |
| the app last | `web` binds the Hyperdrive id (`WIRING_CLOUDFLARE_HYPERDRIVE_<ENV>`, rendered into `wrangler.jsonc` before the build) and queries the migrated schema, so it declares `dependsOn` on `cloudflare-hyperdrive` and `db-migrate`, enforced on main |
| stage before prod | deferred during the bootstrap (below), so both environments run their chains side by side |

Every one of these edges is **advisory on a pull request**, which applies and
deploys nothing. `testing/placement.test.sh` plans the placed product's own
push to main and reads the order off it:
`supabase → cloudflare-hyperdrive → db-migrate → web`.

## What runs

The run's task set-up — the epic, both milestones, both tasks — runs in the
background from the start (`background: true`), so every hook up to `task`
runs beside it; `task` is the first that waits for it.

| hook | what it does |
|---|---|
| `retouch` | one trailing `# orun: redeploy 01-product <stamp>` line in each component `.baseline/tasks/01-product.TaskContract.yaml` names (supabase, cloudflare-hyperdrive, db, db-migrate, web), so a RE-RUN has a diff to land |
| `git-init`, `stage` | the tree becomes a git repository with a populated index (the rebrand enumerates `git ls-files`) |
| `rebrand` | renames the baseline's identity to the product's: the slug (intent, worker, secret project, the `repo` the Supabase project and Hyperdrive config are named after), the name seam, the domain, the workers.dev subdomain. The upstream template's own links and every migration are left alone |
| `orun-workspace` | writes the product's workspace into `intent.yaml` |
| `work-tree` | strips this repository's `work:` block from the product's intent |
| `promotion`, `dev-lanes` | defer prod's wait on stage and dev's push lanes until `02-docs` |
| `restage`, `rebrand-verify` | the sweep: no baseline identity left |
| `repo` | `orun.repo/ensure@v1`: creates (or finds) `<githuborg>/<reponame>` |
| `link` | the repository becomes the workspace's (`orun cloud link`, best effort; `orun cloud check` is the gate). Every convergence lane authenticates over GitHub OIDC through that link |
| `secrets-cloudflare` | `orun.integrations/reconcile@v1`, Cloudflare's three keys in one hook, each under its own scope, created side by side: `CLOUDFLARE_API_TOKEN` (workers-deploy, the app's deploy and its Workers AI binding), `CLOUDFLARE_HYPERDRIVE_TOKEN` (hyperdrive-edit — the deploy token cannot touch Hyperdrive), `CLOUDFLARE_ACCOUNT_ID` (account-id). Keys that exist are kept |
| `secrets-supabase` | the same for Supabase's two: `SUPABASE_ACCESS_TOKEN` (management-access, the project and the migrations), `SUPABASE_ORG_ID` (org-id) |
| `task` | finds the phase's task and yields its key — waiting, if it must, for the background set-up |
| `land` | one PR bound to the task, its commit checked in the box first (`checks: local`: `orun validate`, then `orun plan` as the PR and as the merge would plan it, under a second); merged without waiting for the PR's CI (`plan` alone on a bootstrap branch) |
| `converge` (await) | `orun.run/watch@v1` on the merge commit's run, read every 5 s; resumes it up to three times |
| `verify` (await) | `orun.http/probe@v1`: `/` and `/api/health` on both workers.dev URLs |

## What the convergence does, per environment

1. **supabase** — `terraform apply`: one project, `<reponame>-<env>`, in the
   org `SUPABASE_ORG_ID` names, with a generated database password. Its
   outputs are lease-published as `SUPABASE_PROJECT_REF`,
   `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL`. A new project takes five to
   seven minutes to come up.
2. **cloudflare-hyperdrive** — `terraform apply` with the Hyperdrive token: a
   config over the project's Postgres, published as
   `WIRING_CLOUDFLARE_HYPERDRIVE` (its id and name).
3. **db-migrate** — builds `@saas/db` and applies every migration the
   database's `_migrations.applied` ledger does not have, through Supabase's
   Management API: upstream's schema with the `vector` extension and
   row-level security on both tables (010), the embedding column resized to
   Workers AI's 768 dimensions and the match function moved to cosine (020),
   and the two functions closed to Supabase's Data API (030). The app
   reaches them as `postgres`, which owns them.
4. **web** — installs, re-renders `wrangler.jsonc` from this environment's
   wiring document, builds with OpenNext, deploys `<reponame>-web-<env>`,
   and smoke-tests it: the search page; `POST /api/embeddings`, which
   INDEXES the docs — the Worker embeds every page of the committed
   `lib/docs/index.generated.json` whose checksum the database does not
   hold, so a redeploy with unchanged docs embeds nothing; and
   `/api/health`, which answers only when the database behind the binding
   is reachable and migrated, and must report more than zero sections. The
   Worker's `AI` binding is Workers AI in the same account: nothing to
   provision, and no credential reaches the build or the CI runner.

No AI vendor is in it: no connection brokers one, and the app embeds and
answers on Workers AI without a key. OpenAI for the answers is the owner's
to add (the product's README, "Use OpenAI for the answers").

## Verify / done means

- The convergence for the merge commit is green on stage and prod — in it,
  Hyperdrive and db-migrate resolved the Supabase project's
  `SUPABASE_PROJECT_REF`, `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL`, and
  the app's deploy `WIRING_CLOUDFLARE_HYPERDRIVE`, from stage and prod, where
  every later run reads them. A missing one fails its lane, so there is no
  separate check that they exist.
- `/` and `/api/health` answer on both workers.dev URLs, and each
  environment's index holds the docs (its smoke step's `/api/embeddings`).

## Failure modes

| symptom | meaning → fix |
|---|---|
| parks on the `providers` probe | a connection is missing — GitHub on the repository's owner, Cloudflare, or Supabase. Connect it (console → Integrations); the probe is a wait, not a failure |
| supabase apply: `does not support oauth access` | the provider is above 1.5.x, which reads billing endpoints an OAuth token cannot — `~> 1.5.1` is pinned for this reason |
| supabase apply: project name already exists | `adopt.tf` looks the project up by name and imports it — if you removed that file, restore it |
| hyperdrive or db-migrate lane: secret resolution failed (`SUPABASE_*`) | the supabase apply for that environment did not publish — read its log; both wait on it, so they show as not run |
| web lane: secret resolution failed (`WIRING_CLOUDFLARE_HYPERDRIVE_*`) | a Hyperdrive apply did not publish its wiring (the root lost its `secretOutputs`, or its lane was not in the plan) — read the cloudflare-hyperdrive lane; re-run the phase and its retouch marker re-plans it |
| `land`: `the landing's own check failed — orun plan for …` | the placed tree does not plan; the next line is orun's own error. Nothing was pushed. Fix it (or the baseline) and re-run the phase |
| `land` waits on CI after all | the product's repository requires a status check on `main` (branch protection or a ruleset), so GitHub refused the early merge; the landing waits for the check as a `checks: ci` landing would, then merges |
| hyperdrive apply: Authentication error (10000) | the token in play is workers-deploy, which deliberately cannot touch Hyperdrive — the component binds `CLOUDFLARE_HYPERDRIVE_TOKEN` |
| db-migrate: checksum mismatch | an applied migration's file changed. Never edit one; add a new migration |
| db-migrate: `nods_page_section holds N vector(s) from another embedding model` | migration 020's guard: the database ran upstream's schema with OpenAI's 1536-dimension embeddings. Nothing changed and the app did not deploy. Delete them as the message says, then re-run the phase — its deploy re-indexes the docs |
| web smoke: `/api/health` 503 | the database is unreachable through the binding (`database: unreachable`) or not migrated (`schema: missing`) — the Hyperdrive and db-migrate lanes for that environment say which |
| web smoke: `/api/embeddings` 500 or 503 | 500: a page failed to index, and the JSON names it and the error (Workers AI, or the database) — re-run the phase, stored pages are skipped. 503: the Worker lost its `AI` or `HYPERDRIVE` binding (restore `wrangler.jsonc` from `wrangler.template.jsonc`) |
| `build-app` fails: `Symlink apps/web/node_modules/next is invalid, it points out of the filesystem root` | the product's intent pins stack-tectonic ≥ 0.20.0 (lane-scoped install), which Next 16's Turbopack refuses. Pin 0.19.0 — `intent.yaml` says why |
| `verify-app-structure` fails: `test -f wrangler.jsonc` | `apps/web/wrangler.jsonc` is not committed. It must be: the check runs before the build, in a fresh checkout (`pnpm run wire:fixture` renders it) |
| the watch says green, the probe says 404 | another workflow ran on the push and the watch took its run. Only `ci.yml` may run on a push to main |
| re-run lands nothing | the hooks did not run (`--run-hooks`), or the contract names no component — `node tooling/bootstrap/retouch.mjs --check --affects .baseline/tasks/01-product.TaskContract.yaml` in the product's tree says which |

## Re-running

Idempotent: placement is additive, the rebrand is a no-op on branded files,
`git init` and the repo step are guarded, the Supabase project and the
Hyperdrive config are adopted rather than recreated, and the migration
ledger lives in the database, so only missing migrations apply. A re-run of
a phase whose PR already merged lands the retouch markers alone, which
re-plans exactly the components they name. Once the tree is branded the
phase derives as `drifted`, so `--resume` leaves it alone; re-run it
deliberately with `--phase 01-product` (or `--redo 01-product`).

## What one convergence will run, before running it

From a placed product's tree:

```bash
node <baseline>/tooling/bootstrap/promotion.mjs --defer && node <baseline>/tooling/bootstrap/dev-lanes.mjs --defer
orun plan --intent intent.yaml --trigger github-push-main -v lanes
git checkout intent.yaml
```
