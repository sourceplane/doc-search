# BOOTSTRAP — a new doc search from this baseline, in one landing

How to go from **nothing** to **a documentation search live on stage and
prod — its own Supabase project per environment, Hyperdrive in front of it,
the pgvector schema applied, the app deployed, its docs indexed and answered
on Workers AI — documented**, with two provider consents and no AI vendor
key.

There is one artifact: **`repo-blueprint.yaml`**. It declares what to place,
in what order, what each phase needs first, and what to say while it runs.
`orun new` is the whole runtime — the phases below are its `--phase` names,
not separate workflows. The console card the platform renders is
**`blueprint.yaml`**; it names the build document and states the inputs, the
brokered secrets and the programme, and `testing/manifest.test.sh` holds it
to what the build document does.

Target wall-clock: **about eighteen minutes** — an estimate summed from the
phases (17 + 1) until a bootstrap measures it. The shape: the task set-up in
the background while ONE landing is placed, branded and checked in the box
(`orun validate` and `orun plan`, no runner waited for), then one convergence
per environment (stage and prod side by side until `02-docs` restores the
promotion gate) that creates the Supabase project (five to seven minutes),
the Hyperdrive config, applies the migrations and builds and deploys the app,
in that order, then a short docs landing.

## 0. What you need

- GitHub org access (repository creation) and a machine with `git`, `node`
  (≥ 22), `pnpm` (10.12.1), `python3` with PyYAML, `curl`, and the `orun`
  CLI **≥ v2.88.0** — the floor for RUNNING the bootstrap (the phase overlay,
  `githubOwner` on the doctor probe, `from: workspace`, the deploy
  credentials minted in one `secrets` reconcile per provider, the task set-up
  run in the background (`background: true`), and landings checked in the box
  before they merge (`checks: local`)). The product's own `ci.yml` pins its
  lanes separately (v2.78.4), and that pin — or anything newer, as the floor
  is — is what reads the per-edge `mode` rules the convergence order relies
  on.
- A **Cloudflare** account (the free plan is enough for one Worker with
  static assets, Hyperdrive and Workers AI) and its Account API token with
  the permission groups the console's Connect recipe lists — Workers Scripts
  and Hyperdrive among them. **Workers AI** is the embedding and answer
  model: every account has it, nothing is provisioned, and it bills the
  account after its free daily allocation. The Worker reaches it through an `AI`
  binding the deploy token uploads with the script.
- **Supabase: an organization with room for TWO more projects**,
  `<reponame>-stage` and `<reponame>-prod` — the product creates one per
  environment, and Supabase's free plan allows two active projects per
  organization, so on the free plan the organization must have none active
  already (or be on a paid plan). Connected to the workspace by OAuth
  consent (console → Integrations → Supabase) or a pasted personal access
  token. The connection is anchored on ONE organization, and that is where
  both projects are created: for an account in several organizations, the
  OAuth consent, where you pick one, is the way to be sure which.
- An Orun Cloud workspace for the product — `orunWorkspace`, or the workspace
  the build runs in (ORUN_WORKSPACE) when that is unset — with an
  **admin-role API key** for headless runs (secret writes below admin are
  masked as `not_found`).
- **The repository allow-listed in the workspace** (console → Settings → Git
  repos), unless the credential can write links. `01-product`'s `link` step
  stops and names the fix if it is not.
- **No AI vendor key.** No platform brokers one and none is needed: the
  models are Workers AI's. Upstream's own answer model (OpenAI's, with
  `OPENAI_API_KEY`) is the owner's to add afterwards (§3).

## 1. One command: `--resume`

The whole bootstrap, unattended. `--resume` places every phase not already
derived as done, in order, honouring each phase's barrier:

```bash
git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/doc-search
cd doc-search

orun new --blueprint repo-blueprint.yaml \
  --out ~/products/acme-docs --run-hooks --resume \
  --set reponame=acme-docs --set productname="Acme Docs" \
  --set githuborg=acme-inc \
  --set orunWorkspace=ws_XXXXXXXX \
  --set subdomain=<workers-dev-subdomain>
```

`subdomain` is the workers.dev subdomain of the Cloudflare account you deploy
into (Workers & Pages → your subdomain). A build started from the console, or
with `orun baseline new --from bst_…`, never asks for it: the platform reads
it from the workspace's Cloudflare connection, the same one the deploy tokens
mint from. Only a hand-run build like this one passes it.

**`--run-hooks` is the difference between placing files and bootstrapping a
product.** Without it `orun new` writes the tree and stops: no repository, no
landing, no convergence watch, no probe. That is deliberate — it is what
makes the offline bootstrap in `testing/` possible with no workspace and no
provider.

`--resume` is safe to re-run from anywhere, a fresh container with a fresh
`--out` included: **phase state is derived from the tree, never stored.** A
phase whose files are present but branded derives as `drifted`, and
`--resume` leaves it placed rather than reverting the product's identity.

## 1b. Or phase by phase

| phase | what it lands | verified by |
|---|---|---|
| `01-product` | the repository, created and linked; the five brokered credentials; then the whole product in one PR — intent, CI, tooling, identity, the Supabase and Hyperdrive Terraform roots, the pgvector migrations, the app, its docs index and its tests | its commit validated and planned in the box (as the PR and as the merge), then merged; the convergence green (supabase → cloudflare-hyperdrive → db-migrate → web, per environment — each resolving what the apply before it published); the web smoke indexing the docs through the deployed Worker, and `/` and `/api/health` answering on both workers.dev URLs |
| `02-docs` | `ai/context/deployment.md` from probed facts (the index and the answer's model included); prod's promotion gate and dev's push lanes restored | the render's own probes, recorded; the commit checked in the box and merged |

```bash
orun new --blueprint repo-blueprint.yaml --out ~/products/acme-docs --run-hooks \
  --phase 01-product --values ~/acme-docs.values.yaml
# … then 02-docs
```

`02-docs` reads the identity back from `.rebrand/values.json` in the placed
tree, but the blueprint's **required** inputs — `reponame`, `productname`,
`githuborg` — are validated before anything runs, so pass them every time (a
`--values` file is easier). The domain is not one of them: the product goes live
on workers.dev, and `productdomain` defaults to empty, which brands the
reserved placeholder `<reponame>.example.com` into `BASE_DOMAIN` for an owner
to replace when they attach a domain (README, "Custom domain"). Pass
`--set productdomain=` only for a product that already has its domain.
The full guide, one page per phase: [docs/phases/README.md](docs/phases/README.md).

| flag | what it does |
|---|---|
| `--status` | derives and prints every phase's state and writes nothing. It parses the document, validates each hook against the action registry and compiles every template; it needs no credential and no network |
| `--phase <name>` | places exactly that phase; its `requires.phases` still gates |
| `--until <name>` | places every phase through that one and stops |

What lands in the product is PRODUCT-ONLY: the app, the Terraform roots, the
migrations and their runner, the tests, its CI, its tooling, its README and
its two context pages. None of this repository's machinery (`.baseline/`, the
blueprints, `tooling/rebrand`, `tooling/bootstrap`, `hooks/`, `testing/`,
`docs/phases/`, `specs/`, `tasks/`, this file) ships, and no shipped file
names any of it. That promise is a test: `testing/leak.test.sh` derives what
every phase would place and gates the set and every file's text, and
`testing/placement.test.sh` gates the same rules over a placed, branded tree.

## 2. Headless / container mode

The blueprint's source is this repository (`sources: [{kind: dir, path: .}]`),
so the container contract is a shallow clone at a pinned tag plus two
tokens:

```bash
export ORUN_TOKEN=…          # orun auth, headless
export GITHUB_TOKEN=…        # fine-grained PAT (below)

git clone --depth 1 --branch <baseline-tag> https://github.com/sourceplane/doc-search
cd doc-search
orun new --blueprint repo-blueprint.yaml \
  --out /work/acme-docs --run-hooks --resume --progress json \
  --values /work/acme-docs.values.yaml
```

| requirement | detail |
|---|---|
| `GITHUB_TOKEN` | fine-grained PAT: **read** on this repository; on the PRODUCT's repository **contents write**, **pull-requests write**, **actions read+write** (`orun.run/watch@v1` resumes runs with `gh run rerun`), **checks read**; **repository create** on the owner if `01-product` creates it (or pre-create it — supported) |
| classic token caveat | a classic PAT or gh OAuth token also needs the `workflow` scope to push `.github/workflows/` |
| pinning | the clone's `--branch <tag>` pins everything: the blueprint, its modules and its hooks' scripts all come from that one commit |

## 3. After the product is live

- **Nothing to connect.** The product embeds and answers on Workers AI from
  its first deploy, and that deploy's smoke step indexed the docs. Try it:
  press ⌘K and ask about the sample page.
- **Your own docs**: replace `apps/web/pages/docs/**/*.mdx`, run
  `pnpm --filter @app/web docs:index`, commit both, and merge. The next
  deploy embeds the pages that changed and drops the ones that are gone
  (the product's README, "Your docs").
- **OpenAI for the answers** (optional, per environment): set an OpenAI key
  as a Worker secret and the answer is upstream's own — OpenAI's chat model
  straight from OpenAI, with its moderation step first:

  ```bash
  wrangler secret put OPENAI_API_KEY --name <reponame>-web-<env>
  ```

  The embeddings stay on Workers AI — the column is sized to its model. The
  product's README, "Use OpenAI for the answers", is the owner's copy of
  this.
- **Custom domain**: attach it to the Worker in Cloudflare (the product's
  README, "Custom domain"). Nothing in the build names the origin, so
  nothing else changes. There is no domain phase: attaching a domain needs
  zone permissions the brokered `workers-deploy` token does not carry.
- **Refresh the record**: re-run `--phase 02-docs`; it is idempotent, and it
  records how much of the docs is indexed and which model answers.

## 4. Testing this baseline

`.github/workflows/baseline.yml` runs three tiers on every pull request, and
each runs locally the same way:

```bash
for t in manifest phases coverage rebrand retouch bootstrap-defer; do bash testing/$t.test.sh; done
bash testing/leak.test.sh        # needs orun
bash testing/placement.test.sh   # needs orun, node, pnpm: the offline bootstrap and the product's own plans
bash testing/e2e.test.sh         # + network for pnpm, psql, a PostgreSQL server install and its pgvector package
```

The offline bootstrap (`testing/lib/bootstrap.sh`) places both phases in
order and finishes each with the blueprint's OWN `run:` hooks — read out of
`repo-blueprint.yaml`, not transcribed — so the retouch marker, the rebrand,
the re-tenant, the deferrals and their restore and the deployment record
all run exactly as a real bootstrap runs them. Only the platform's typed
actions (task, repo, reconcile, land, watch, probe) and the `link` step are
stood in for, a landing becoming a commit.

What no test here can do is the clouds' half: create a Supabase project,
apply the Hyperdrive config, mint a token, deploy for real, call a real
Workers AI model. The Terraform roots are held to `fmt`, `init
-backend=false` and `validate` (a real `plan` reads Supabase's API and the
platform's state backend); the convergence ORDER is proven on the product's
own `orun plan`; the migrations are applied by the product's own runner to a
local Postgres with pgvector through a stand-in for the one Supabase
Management API endpoint it calls (`testing/lib/fake-supabase-api.py`); and
the built Worker, under `wrangler dev`, is indexed by the product's own
smoke command, skips unchanged pages on a second index, embeds once under
two concurrent ones, and answers a question from the matched sections over
that database — with its `AI` binding pointed at a deterministic stand-in
for Workers AI (`testing/lib/fake-workers-ai.js`: bag-of-words embeddings at
768 dimensions and a streamed answer read off the prompt). What the real
models score and answer is verified only by a bootstrap.

## 5. Cutting a baseline tag (maintainers)

Every product built from this repository resolves a `baseline-vN` tag, so the
tag is cut by a workflow rather than by hand:

```bash
gh workflow run tag.yml -f version=baseline-v1          # from main
gh workflow run tag.yml -f version=baseline-v1 -f ref=<sha>
```

It refuses a version that is not `baseline-v<N>` and a tag that already
exists: a baseline tag is never moved. Then add (or move) the registry row in
orun-cloud's `infra/baselines-registry/baselines.yaml` by pull request —
after the tag exists, because the registry's sync fetches `blueprint.yaml`
at the tag and refuses the whole catalogue if it 404s.

## Troubleshooting

| Symptom | Cause → fix |
|---|---|
| `01-product` parks: `waiting for github for <org>` | the workspace's GitHub connection is to another account. Connect the App installation on `<org>` (console → Integrations → GitHub), then `--resume` |
| `01-product` parks on the `providers` probe for cloudflare or supabase | that connection is missing. Connect it (console → Integrations); the probe is a wait, not a failure |
| `01-product` stops at `link` | the repository is not linked to the workspace and the credential cannot link it. Allow-list it (console → Settings → Git repos) and re-run the phase |
| Secret WRITE fails `not_found` while listings work | the API key's role is below admin; re-mint it with the admin role |
| supabase apply: `does not support oauth access` | a supabase provider ≥ 1.6 reads billing endpoints the brokered OAuth token cannot; the root pins `~> 1.5.1` — keep it |
| supabase apply: project limit reached | the Supabase org's plan allows fewer projects than stage + prod need; free one or upgrade, then re-run `01-product` |
| hyperdrive apply: Authentication error (10000) | the Hyperdrive token lacks the permission; reconnect Cloudflare with the recipe's permission groups and re-run the phase — the reconcile re-mints only what is missing |
| hyperdrive or db-migrate: `secret resolution failed … SUPABASE_*` | the supabase apply for that environment did not publish; its lane's log says why. Both wait on it, enforced |
| web: `secret resolution failed … WIRING_CLOUDFLARE_HYPERDRIVE_*` | a Hyperdrive apply published no wiring: the root lost its `secretOutputs`, or its lane was not in the plan. Re-run the phase; its retouch marker re-plans the Hyperdrive root |
| `land` stops: `the landing's own check failed — orun plan for …` | the product's tree does not plan — the line after it is orun's own error (an unknown component type, a composition that does not resolve). Nothing was pushed. Fix the tree (or the baseline) and re-run the phase |
| `land` waits on CI after all | the product's repository requires a status check on `main` (branch protection or a ruleset), so GitHub refused the early merge; the landing waits for the check as a `checks: ci` landing would, then merges |
| the index or the search fails `permission denied for function match_page_sections`, or the index stores rows the search never finds | the Worker reaches Postgres as a role other than `postgres`, which owns the tables and the functions: upstream's row-level security (on since 010, with no policies) and 030's revoke both hold against any other role. The Hyperdrive config the root creates connects as `postgres`; a hand-made one must too |
| db-migrate: `nods_page_section holds N vector(s) from another embedding model` | migration 020 refused to resize a column holding another model's vectors (only a database that ran upstream's schema with OpenAI's embeddings has any). Nothing changed; delete them as the message says and re-run — the next deploy re-indexes the docs |
| web smoke: `/api/embeddings` 500 | the index ran and a page failed; the JSON names the page and the error (a Workers AI error, or the database). Re-run the phase: the pages already stored are skipped |
| web smoke: `/api/embeddings` 503 | the Worker has no `AI` or `HYPERDRIVE` binding — its `wrangler.jsonc` lost the block. Restore it from `wrangler.template.jsonc` (`pnpm run wire:fixture`) |
| web smoke: `/api/health` 503 | `database: unreachable` — the Hyperdrive config is wrong or the project is paused; `schema: missing` — db-migrate did not run for that environment, or the embeddings column is not the model's 768 dimensions |
| web smoke fails on `"sections":0` after the index answered ok | the index stored nothing: `pages/docs` holds no `.mdx`, or `lib/docs/index.generated.json` was committed empty. Run `pnpm --filter @app/web docs:index`, commit it, and re-run |
| web deploy refused over the `AI` binding (an authentication error naming Workers AI) | the brokered deploy token cannot attach a Workers AI binding in this account. Reconnect Cloudflare with the recipe's permission groups (adding Workers AI if the recipe lists it) and re-run the phase |
| the search says the documentation has not been indexed yet | no deploy has indexed this environment (its smoke step never ran), or the database was reset. `curl -X POST <url>/api/embeddings` indexes it now |
| the search answers "Sorry, I don't know how to help with that." to every question | nothing scores above `MATCH_THRESHOLD` (0.6 by default). Lower it with a Worker secret (the product's README, "Tuning the search"), or `POST /api/embeddings?refresh=1` if the sections were embedded by another model |
| `build-app` fails: `Symlink apps/web/node_modules/next is invalid, it points out of the filesystem root` | the product's intent pins stack-tectonic ≥ 0.20.0, whose lane-scoped install links each job's node_modules out of its tree, which Next 16's Turbopack refuses. Pin 0.19.0 (`intent.yaml` says why) |
| `verify-app-structure` fails: `test -f "wrangler.jsonc"` | the product's `apps/web/wrangler.jsonc` is not committed. It must be — the check runs before the build in a fresh checkout (`pnpm run wire:fixture` renders it) |
| Convergence failed AFTER the PR merged; re-running lands nothing | expected on its own — the files are on main. Re-run the phase (`--phase 01-product`, `--redo 01-product`, or the console's Retry): its `retouch` hook gives the landing a diff and the components re-plan; the project and the config are adopted, not recreated |
| The convergence reported green, then `verify` got 404 | a second workflow ran on the push to main and the watch took its run. Only `ci.yml` may run on a push to main |
| The product's `intent.yaml` says `workspace: ws_SET_ME` | `orunWorkspace` was empty and the build ran outside a workspace; set it and re-run `01-product` |
| A bootstrap stopped before `02-docs`; prod no longer waits on stage | the gate is deferred, not dropped: run `02-docs`, or `node tooling/bootstrap/promotion.mjs --restore --file <product>/intent.yaml` |
| `✕ input "productname" is required` | all three required inputs (`reponame`, `productname`, `githuborg`) must be set on every invocation, single-phase ones included |
| `unknown flag: --phase`, `has no parameter "checks"`, `has no parameter "secrets"` or another parse error in the blueprint | the CLI is below the v2.88.0 floor |
