#!/usr/bin/env bash
# TIER 2 — the product a bootstrap produces builds, migrates, deploys (dry),
# serves, indexes its docs and answers a question from them, with no AI
# vendor key.
#
# placement.test.sh proves the tree a bootstrap ends with is the right tree,
# and that its own plan converges in the right order. This proves it WORKS,
# by doing to it what its own pipelines will:
#
#   1. at the 01-product landing (the commit its PR merges), install with the
#      lockfile the product ships, render the wrangler fixture (which must
#      change nothing: the render is committed), typecheck, lint, test, build.
#      The landing itself is checked in the build box with `orun validate`
#      and `orun plan` alone (`checks: local`), and its PR runs `plan` alone
#      (an `orun/BASE-*` branch), so THIS is where a product those steps
#      refuse is caught: before the tag, not after a build has merged it;
#   2. a Postgres of its own on a random port, with Supabase's roles — the
#      database a Supabase project would be: `postgres` a login role WITHOUT
#      superuser or BYPASSRLS, `anon` and `authenticated` with the Data API's
#      default grants — and pgvector, which the stand-in's superuser creates
#      up front where Supabase lets `postgres` create it itself
#      (testing/lib/local-postgres.sh); and a stand-in for the ONE Supabase
#      Management API endpoint the migration runner calls
#      (testing/lib/fake-supabase-api.py), connected as `postgres`;
#   3. the db-migrate lane's own steps, rendered by `orun plan` for a push to
#      main and run IN THE TREE THE RUNNER STAGES for the job: install, build
#      @saas/db, apply — every migration: the template's schema, the
#      embedding column and the search function resized to Workers AI's 768
#      dimensions, the two functions closed to the Data API — then apply
#      again, which must apply nothing, and the pull-request profile's
#      offline plan;
#   4. the web lane's own steps for stage, rendered for a pull request (the
#      verify profile carries deploy-dry-run; the deploy profile does not) and
#      run in its staged job tree: install, `verify-app-structure` (the
#      committed wrangler.jsonc must exist BEFORE the build, in a tree with no
#      build output), `build-app` — which re-renders the config from the
#      stage wiring document it is handed, as the deploy does — then
#      `verify-build-output` and `deploy-dry-run`;
#   5. the built Worker under `wrangler dev`, its HYPERDRIVE binding pointed at
#      that Postgres, with NO .dev.vars — no AI vendor key — and its AI
#      binding pointed at a deterministic stand-in for Workers AI
#      (testing/lib/fake-workers-ai.js), because Workers AI has no local mode
#      and this machine has no Cloudflare account. Then the component's OWN
#      `smokeCommand` against it, verbatim — which INDEXES the docs (POST
#      /api/embeddings: the Worker embeds the docs it was built with and
#      writes them through Hyperdrive, upstream's build-time step moved to the
#      deploy) — and every route the product promises: the page under the
#      product's own name, `/api/health` (answered only by the Worker), a
#      404; the index as stored (one page, a section per heading, vector(768),
#      the build's checksum and token counts); a second indexing that embeds
#      nothing, and two at once that embed the page once; a question about
#      the docs answered, streamed, from the section pgvector ranked first; a
#      question sharing nothing with the docs answered upstream's "Sorry, I
#      don't know how to help with that."; an empty index answered with a
#      message, not a failure; a request without a question refused (400);
#   6. the Data API's view of the same database: both tables have row-level
#      security, and `anon` and `authenticated` — granted everything Supabase
#      grants them — read none of the rows the indexing wrote, write none and
#      call neither function, while the app, as the tables' owner and nothing
#      more, just did all three.
#
# WHAT IS VERIFIED ONLY OFFLINE: the models. The stand-in answers in the
# shapes the Workers AI catalog types for the two models, so the app's
# provider, its SQL and its stream are the real ones; what a real Llama 4
# Scout writes, and what bge-base-en-v1.5's vectors retrieve at the default
# MATCH_THRESHOLD, is not tested here (the stand-in's bag of words lives in
# another space, so this tier sets the threshold for it). Nor is the platform's half: create the
# repository, mint the brokered tokens, create a real Supabase project and
# Hyperdrive config (Terraform is validated, not applied, in this
# repository), deploy for real and probe workers.dev. That is a bootstrap
# against a workspace (BOOTSTRAP.md); everything short of it is here.
#
# Needs: orun, node, pnpm, python3 (+PyYAML), git, curl, psql, a PostgreSQL
# server install (initdb, pg_ctl) with pgvector (postgresql-<major>-pgvector),
# and the network for `pnpm install` (or a warm store). A few minutes: three
# installs, two builds.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=lib/bootstrap.sh
source "$here/lib/bootstrap.sh"
# shellcheck source=lib/local-postgres.sh
source "$here/lib/local-postgres.sh"

for bin in orun node pnpm python3 git curl psql; do
  command -v "$bin" >/dev/null || { echo "e2e.test.sh needs $bin on PATH" >&2; exit 1; }
done
pg_bin >/dev/null || { echo "e2e.test.sh needs a PostgreSQL server install (initdb, pg_ctl)" >&2; exit 1; }
# pgvector: pg_up fails naming the package when the server has no `vector`.

scratch="$(mktemp -d)"
pgdir="$(mktemp -d)"
dev_pid=""
api_pid=""
# wrangler dev runs under pnpm, node and two workerd processes; a TERM to the
# first does not reach the rest, and waiting on it then never returns. So each
# server is started as its own process group (setsid) and the group stopped.
stop_group() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 -- "-$pid" 2>/dev/null || break; sleep 0.5; done
  kill -KILL -- "-$pid" 2>/dev/null || true
}
cleanup() {
  stop_group "$dev_pid"
  stop_group "$api_pid"
  pg_down "$pgdir"
  [ -n "$pgdir" ] && [ -d "$pgdir" ] && rm -rf "$pgdir"
  [ -n "$scratch" ] && [ -d "$scratch" ] && rm -rf "$scratch"
}
trap cleanup EXIT
free_port() { python3 -c "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1]);s.close()"; }
values="$here/fixtures/acme.json"
repo="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['reponame'])" "$values")"
export CI=1 WRANGLER_SEND_METRICS=false NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

# The landing's own checks, step for step — what the product's Checks
# workflow ran on a pull request before the product carried ci.yml alone —
# run here at once on the whole tree.
LANDING_CHECKS=(
  "pnpm install --frozen-lockfile"
  "pnpm run wire:fixture"
  "pnpm typecheck"
  "pnpm lint"
  "pnpm test"
  "pnpm build"
)
checks() { # DIR LOG
  local dir="$1" log="$2" cmd
  for cmd in "${LANDING_CHECKS[@]}"; do
    echo "   \$ $cmd" | tee -a "$log"
    if ! (cd "$dir" && bash -c "$cmd") >> "$log" 2>&1; then
      echo "FAIL: \`$cmd\` failed in $dir" >&2; tail -40 "$log" >&2; return 1
    fi
  done
}

# One job of a plan, written out as the runner would run it: each `run:` step
# (the `use:` actions are setup-node and setup-pnpm, which this machine has)
# as a numbered script, the job's env, and the component path the steps run
# in. Steps are picked BY ID when given, else every `run:` step in order.
extract_job() { # PLAN JOB-ID OUT-DIR [STEP-ID…]
  python3 - "$@" <<'PY'
import json, pathlib, sys
plan, jid, out, *want = sys.argv[1:]
job = next((j for j in json.load(open(plan))["jobs"] if j["id"] == jid), None)
if job is None:
    sys.exit(f"the plan has no job {jid}")
out = pathlib.Path(out); out.mkdir(parents=True)
steps = [s for s in job["steps"] if s.get("run")]
if want:
    by = {s["id"]: s for s in steps}
    missing = [w for w in want if w not in by]
    if missing:
        sys.exit(f"{jid} has no step(s) {missing}")
    steps = [by[w] for w in want]
for i, s in enumerate(steps):
    (out / f"{i:02d}.sh").write_text(s["run"])
    (out / f"{i:02d}.id").write_text(s["id"])
(out / "path").write_text(job.get("path") or ".")
with (out / "env").open("w") as f:
    for k, v in (job.get("env") or {}).items():
        f.write(f"export {k}={json.dumps(v)}\n")
PY
}
run_job() { # STEPS-DIR WORK-TREE ENV LOG-PREFIX
  local steps="$1" work="$2" envname="$3" logp="$4" s id
  for s in "$steps"/[0-9][0-9].sh; do
    id="$(cat "${s%.sh}.id")"
    echo "   ▸ $id"
    if ! (cd "$work/$(cat "$steps/path")" && source "$steps/env" && export ORUN_ENVIRONMENT="$envname" \
          && bash -e "$s") > "$logp-$id.log" 2>&1; then
      echo "FAIL: the lane's $id step" >&2; tail -40 "$logp-$id.log" >&2; return 1
    fi
  done
}

echo "── the offline bootstrap (testing/lib/bootstrap.sh)"
tree="$scratch/$repo"
bootstrap_offline "$root" "$tree" "$values" "$scratch/logs" > "$scratch/bootstrap.log" 2>&1 || {
  echo "FAIL: the offline bootstrap stopped" >&2; tail -40 "$scratch/bootstrap.log" >&2; exit 1; }
echo "   2 phases placed and landed"

# ── 1. the product's own pull request ──────────────────────────────────────
echo "── 01-product's landing: install, the fixture render, typecheck, lint, test, build"
s01="$(git -C "$tree" rev-parse HEAD~1)"
at01="$scratch/at-01/$repo"
git -C "$tree" worktree add -q "$at01" "$s01"
checks "$at01" "$scratch/checks.log"
dirty="$(git -C "$at01" status --porcelain)"
[ -z "$dirty" ] || { echo "FAIL: the checks changed tracked files — the committed wrangler.jsonc is not the fixture render:" >&2; echo "$dirty" >&2; exit 1; }
echo "   the checks left the tree as committed (wire:fixture rendered the committed wrangler.jsonc)"

# ── 2. a database, and the one API the migration runner calls ──────────────
echo "── a local Postgres and the Supabase Management API stand-in"
pgurl="$(pg_up "$pgdir" "$(free_port)" vector)" || { echo "FAIL: Postgres did not start" >&2; exit 1; }
api_port="$(free_port)"
ref="localproject"
setsid python3 "$here/lib/fake-supabase-api.py" "$api_port" "$pgurl" --ref "$ref" > "$scratch/api.log" 2>&1 < /dev/null &
api_pid=$!
for _ in $(seq 1 30); do curl -s -o /dev/null "http://127.0.0.1:$api_port/" && break; sleep 0.3; done
echo "   $pgurl; the API on :$api_port"

# The two plans the lanes below run from, each in the product's own tree: a
# push to main at the 01-product commit (the db-migrate lane's APPLY profile),
# and a pull request over the finished product against an empty base (the web
# lane's VERIFY profile, which carries deploy-dry-run, and db-migrate's PLAN).
(cd "$at01" && orun plan --intent intent.yaml --trigger github-push-main --env stage --output "$scratch/plan-main.json") > "$scratch/plan-main.log" 2>&1 \
  || { echo "FAIL: orun plan (push to main)" >&2; tail -15 "$scratch/plan-main.log" >&2; exit 1; }
git -C "$tree" worktree remove --force "$at01"
mkdir -p "$scratch/pr"
git clone -q "$tree" "$scratch/pr/$repo"
prtree="$scratch/pr/$repo"
git -C "$prtree" checkout -q --orphan empty
git -C "$prtree" rm -rqf .
git -C "$prtree" -c user.email=t@example.invalid -c user.name=t commit -qm empty --allow-empty
git -C "$prtree" checkout -q main
(cd "$prtree" && orun plan --intent intent.yaml --trigger github-pull-request --base empty --head HEAD --env stage \
   --output "$scratch/plan-pr.json") > "$scratch/plan-pr.log" 2>&1 \
  || { echo "FAIL: orun plan (pull request)" >&2; tail -15 "$scratch/plan-pr.log" >&2; exit 1; }
# This tier runs the bootstrap floor, newer than the orun the product's CI
# pins, and both read the per-edge `modeRules`: on a pull request — which
# applies and deploys nothing — the infrastructure edges that order a push to
# main are advisory, so no lane waits on another. (placement.test.sh checks
# the push to main's order.)
python3 - "$scratch/plan-pr.json" <<'PY'
import json, sys
jobs = {j["component"]: j for j in json.load(open(sys.argv[1]))["jobs"] if j["environment"] == "stage"}
chain = ["supabase", "cloudflare-hyperdrive", "db-migrate", "web"]
for a, b in zip(chain, chain[1:]):
    ja, jb = jobs[a], jobs[b]
    if ja["id"] in (jb.get("dependsOn") or []) or ja["id"] not in (jb.get("advisoryDependsOn") or []):
        sys.exit(f"FAIL: on a pull request {b}@stage must name {a}@stage as advisory, not wait on it")
print("   pull request: " + " → ".join(chain) + ", every edge advisory")
PY

# ── 3. the db-migrate lane, in its staged job tree ─────────────────────────
echo "── the stage db-migrate lane: install, build @saas/db, apply — then apply again, and the PR's plan"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate" \
  install-dependencies build-db-package "Migration Apply"
extract_job "$scratch/plan-main.json" db-migrate.stage.migrate "$scratch/steps-migrate-again" "Migration Apply"
extract_job "$scratch/plan-pr.json" db-migrate.stage.migrate "$scratch/steps-migrate-plan" "Migration Plan"
# Staged from the fresh clone (a CI checkout: no build output, no
# node_modules); its migrations are the 01-product commit's, byte for byte.
mwork="$prtree/.orun/runs/e2e/db-migrate.stage.migrate/work"
python3 "$here/lib/stage-job.py" "$prtree" "$mwork"
# The component's secretEnv, as the lane resolves it: the supabase apply's
# published credentials and the brokered access token. SUPABASE_API_URL is
# the one value no lane has — it points the runner at the stand-in.
export SUPABASE_ACCESS_TOKEN=e2e-token SUPABASE_PROJECT_REF="$ref" SUPABASE_DB_PASSWORD=postgres \
       SUPABASE_DB_URL="$pgurl" SUPABASE_API_URL="http://127.0.0.1:$api_port"
run_job "$scratch/steps-migrate" "$mwork" stage "$scratch/migrate"
applied() { python3 -c "import json,sys;t=open(sys.argv[1]).read();print(' '.join(json.loads(t[t.index('{'):t.rindex('}')+1])['applied']))" "$1"; }
want="000_control_baseline 010_doc_search_init 020_workers_ai_embeddings 030_data_api_closed"
[ "$(applied "$scratch/migrate-Migration Apply.log")" = "$want" ] \
  || { echo "FAIL: the first apply applied '$(applied "$scratch/migrate-Migration Apply.log")', not '$want'" >&2; exit 1; }
echo "   applied $want"
run_job "$scratch/steps-migrate-again" "$mwork" stage "$scratch/migrate-again"
[ -z "$(applied "$scratch/migrate-again-Migration Apply.log")" ] \
  || { echo "FAIL: a second apply applied '$(applied "$scratch/migrate-again-Migration Apply.log")'" >&2; exit 1; }
echo "   a second apply applied nothing (the ledger holds $(psql "$pgurl" -XAtc 'select count(*) from _migrations.applied') migrations)"
column="$(psql "$pgurl" -XAtc "select format_type(atttypid, atttypmod) from pg_attribute where attrelid = 'public.nods_page_section'::regclass and attname = 'embedding'")"
fn="$(psql "$pgurl" -XAtc "select pg_get_function_identity_arguments(p.oid) || ' -> ' || pg_get_function_result(p.oid) from pg_proc p where p.proname = 'match_page_sections'")"
[ "$column" = "vector(768)" ] && [[ "$fn" == "embedding vector, match_threshold double precision, match_count integer, min_content_length integer -> "*"token_count integer"*"similarity double precision"* ]] \
  || { echo "FAIL: nods_page_section.embedding is '$column' and match_page_sections is '$fn'" >&2; exit 1; }
echo "   nods_page_section.embedding is vector(768) — Workers AI's bge-base-en-v1.5 — and match_page_sections() returns token_count and cosine similarity"
run_job "$scratch/steps-migrate-plan" "$mwork" stage "$scratch/migrate-plan"
[ "$(applied "$scratch/migrate-plan-Migration Plan.log")" = "$want" ] \
  || { echo "FAIL: the pull request's offline plan did not verify every migration" >&2; exit 1; }
echo "   the pull request's plan step verifies every migration's checksum offline"
unset SUPABASE_ACCESS_TOKEN SUPABASE_PROJECT_REF SUPABASE_DB_PASSWORD SUPABASE_DB_URL SUPABASE_API_URL
rm -rf "$mwork"

# ── 4. the web lane's steps, for stage ─────────────────────────────────────
echo "── the stage web lane: install, verify-app-structure, build-app, verify-build-output, deploy-dry-run"
extract_job "$scratch/plan-pr.json" web.stage.verify-deploy "$scratch/steps-web" \
  install-workspace-dependencies verify-app-structure build-app verify-build-output deploy-dry-run
work="$prtree/.orun/runs/e2e/web.stage.verify-deploy/work"
# The job's private tree, staged as orun stages it — no build output, no
# node_modules: under stack-tectonic 0.19.0 the job installs inside it.
python3 "$here/lib/stage-job.py" "$prtree" "$work"
[ ! -e "$work/apps/web/.open-next" ] && [ -f "$work/apps/web/wrangler.jsonc" ] \
  || { echo "FAIL: the staged tree is not a fresh checkout with the committed wrangler.jsonc" >&2; exit 1; }
echo "   staged: $(realpath --relative-to="$prtree" "$work") — no build output, the committed wrangler.jsonc"
# The stage wiring document, as the cloudflare-hyperdrive apply publishes it
# and the lane resolves it (secretEnv WIRING_CLOUDFLARE_HYPERDRIVE_STAGE).
hd_id="e2e0000000000000000000000000c0de"
export WIRING_CLOUDFLARE_HYPERDRIVE_STAGE="{\"hyperdrive_id\":\"$hd_id\",\"hyperdrive_name\":\"stg-$repo-stage\"}"
run_job "$scratch/steps-web" "$work" stage "$scratch/web"
unset WIRING_CLOUDFLARE_HYPERDRIVE_STAGE
build_log="$(ls "$scratch"/web-build-app.log)"
grep -q '(Turbopack)' "$build_log" \
  || { echo "FAIL: the staged build did not run on Turbopack" >&2; grep -m3 'Next.js' "$build_log" >&2; exit 1; }
grep -q "\"id\": \"$hd_id\"" "$work/apps/web/wrangler.jsonc" \
  || { echo "FAIL: build-app did not re-render wrangler.jsonc from the stage wiring document" >&2; exit 1; }
[ "$(node -e 'const fs=require("fs");process.stdout.write(String(fs.readdirSync(process.argv[1]).length))' "$work/node_modules")" -gt 0 ] && [ ! -L "$work/node_modules" ] \
  || { echo "FAIL: the job's install did not land inside its own tree" >&2; exit 1; }
echo "   the staged build ran on Turbopack, inside its own tree, bound to the stage Hyperdrive id it was handed"


# ── 5. serve it with no AI vendor key, Workers AI stood in for ─────────────
echo "── wrangler dev over the built Worker: HYPERDRIVE on the local Postgres, AI on the Workers AI stand-in"
[ ! -e "$work/apps/web/.dev.vars" ] || { echo "FAIL: the staged tree carries a .dev.vars" >&2; exit 1; }
# The stand-in, as a second Worker in the same `wrangler dev`
# (testing/lib/fake-workers-ai.js says what it answers, and why).
fake="$scratch/fake-workers-ai"
mkdir -p "$fake"
cp "$here/lib/fake-workers-ai.js" "$fake/index.js"
printf '{ "name": "fake-workers-ai", "main": "index.js", "compatibility_date": "2026-10-01" }\n' > "$fake/wrangler.jsonc"
# The config the build used, with TWO changes: its `ai` binding becomes a
# service binding named AI to the stand-in, whose `run()` the Worker reaches
# over RPC as it would reach Workers AI's; and MATCH_THRESHOLD is set for the
# stand-in's space (a bag of words, where a question and the section it
# matches share a handful of words out of hundreds — far below what two
# texts about the same thing score in bge-base-en-v1.5's). It is the Worker
# var an owner sets the same way (lib/search.ts). Everything else — the
# Hyperdrive binding, the assets, the flags — is the built config, under the
# Worker name the stage deploy gives it. Written beside it, in the throwaway
# tree.
python3 - "$work/apps/web/wrangler.jsonc" "$work/apps/web/wrangler.e2e.json" "$repo-web-stage" <<'PY' \
  || { echo "FAIL: could not derive the dev config from the built one" >&2; exit 1; }
import json, sys
src, out, name = sys.argv[1:]
cfg = json.loads("\n".join(l for l in open(src).read().splitlines() if not l.lstrip().startswith("//")))
if cfg.pop("ai", None) != {"binding": "AI"}:
    sys.exit("the built Worker's wrangler.jsonc does not bind Workers AI as AI")
if "vars" in cfg:
    sys.exit("the built Worker's wrangler.jsonc carries vars; this tier would overwrite them")
cfg.pop("$schema", None)
cfg["name"] = name
cfg["services"] = [{"binding": "AI", "service": "fake-workers-ai"}]
cfg["vars"] = {"MATCH_THRESHOLD": "0.05"}
json.dump(cfg, open(out, "w"), indent=2)
PY
port="$(free_port)"
(cd "$work/apps/web" && CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$pgurl" \
   exec setsid pnpm exec wrangler dev --config wrangler.e2e.json --config "$fake/wrangler.jsonc" \
   --ip 127.0.0.1 --port "$port" --inspector-port "$(free_port)" \
   --show-interactive-dev-session=false) > "$scratch/dev.log" 2>&1 < /dev/null &
dev_pid=$!
url="http://127.0.0.1:$port"
for _ in $(seq 1 90); do
  curl -s -o /dev/null "$url/" && break
  kill -0 "$dev_pid" 2>/dev/null || { echo "FAIL: wrangler dev exited" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }
  sleep 1
done
curl -s -o /dev/null "$url/" || { echo "FAIL: wrangler dev never answered" >&2; tail -30 "$scratch/dev.log" >&2; exit 1; }

[ "$(psql "$pgurl" -XAtc 'select count(*) from nods_page_section')" = 0 ] \
  || { echo "FAIL: the docs were indexed before the deploy's smoke ran" >&2; exit 1; }
echo "   ▸ the component's own smokeCommand, DEPLOYED_URL=$url — which indexes the docs"
smoke="$(python3 -c "import yaml,sys;print(yaml.safe_load(open(sys.argv[1]))['spec']['parameters']['smokeCommand'])" "$tree/apps/web/component.yaml")"
DEPLOYED_URL="$url" bash -c "$smoke" || { echo "FAIL: the deploy's smoke refused the product" >&2; tail -20 "$scratch/dev.log" >&2; exit 1; }

echo "   ▸ every route the product promises, the index as stored, and questions answered from it"
python3 - "$url" "$values" "$pgurl" "$tree/apps/web/lib/docs/index.generated.json" <<'PY' || { echo "FAIL: the routes; wrangler dev said:" >&2; tail -40 "$scratch/dev.log" >&2; exit 1; }
import html, http.client, json, re, subprocess, sys, threading, time, urllib.error, urllib.request
base, values, pgurl, index_file = sys.argv[1], json.load(open(sys.argv[2])), sys.argv[3], sys.argv[4]
index = json.load(open(index_file))
name, repo, org = values["productname"], values["reponame"], values["githuborg"]
problems = []
def bad(m): problems.append(m)

def req(path, data=None, headers=None, method=None):
    # A GET whose CONNECTION drops (not one that answers an error) is asked
    # again, twice at most, and says so: `wrangler dev` on a loaded machine
    # has dropped one. A POST is never repeated — it would submit twice.
    for attempt in range(3):
        r = urllib.request.Request(base + path, data=data, headers=headers or {}, method=method)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                return resp.status, {k.lower(): v for k, v in resp.headers.items()}, resp.read().decode(errors="replace")
        except urllib.error.HTTPError as e:
            return e.code, {k.lower(): v for k, v in e.headers.items()}, e.read().decode(errors="replace")
        except (http.client.RemoteDisconnected, ConnectionResetError) as e:
            if data is not None or attempt == 2:
                raise
            print(f"   (GET {path}: the connection dropped ({e.__class__.__name__}) — asking again)")
            time.sleep(1)

def sql(query):
    return subprocess.run(["psql", pgurl, "-XAtF", "\t", "-c", query],
                          capture_output=True, text=True, check=True).stdout.rstrip("\n")

def index_docs():
    s, _, body = req("/api/embeddings", b"", {}, "POST")
    return s, json.loads(body)

def search(prompt):
    # As the dialog's useCompletion sends it (streamProtocol: text): the
    # prompt, a plain text stream back.
    s, h, body = req("/api/vector-search", json.dumps({"prompt": prompt}).encode(),
                     {"content-type": "application/json"}, "POST")
    return s, h.get("content-type", ""), body

# ── the page, under the product's own name ────────────────────────────────
s, _, home = req("/")
if s != 200:
    bad(f"/ answered {s}")
# Next.js 16's Pages Router marks every tag next/head writes:
# <title data-next-head="">…</title>.
title = re.search(r"<title(?:\s[^>]*)?>(.*?)</title>", home, re.S)
if not title or html.unescape(title.group(1)) != name:
    bad(f"the page's <title> is {title and title.group(1)!r}, not {name!r}")
if "Next.js OpenAI Template" in html.unescape(home):
    bad("the page still carries the baseline's name")
if "Search..." not in home:
    bad("the page has no search button")
if f'href="https://github.com/{org}/{repo}"' not in home:
    bad(f"the page's GitHub link is not the product's own repository github.com/{org}/{repo}")
s, _, _ = req("/no-such-page")
if s != 404:
    bad(f"/no-such-page answered {s}, not 404")

# ── the index the deploy's smoke wrote ────────────────────────────────────
page = index["pages"][0]
s, _, body = req("/api/health")
if s != 200 or json.loads(body) != {"ok": True, "database": "reachable", "schema": "migrated",
                                    "pages": 1, "sections": len(page["sections"]), "answers": "workers-ai"}:
    bad(f"/api/health after the smoke answered {s} {body}")
pages = sql("select path, checksum, type, source from nods_page")
if pages != f"{page['path']}\t{page['checksum']}\tmarkdown\tguide":
    bad(f"nods_page holds {pages!r}, not the built docs' one page with its checksum")
sections = sql("select heading, slug, token_count, vector_dims(embedding) from nods_page_section order by id")
want = "\n".join(f"{x['heading']}\t{x['slug']}\t{x['tokenCount']}\t768" for x in page["sections"])
if sections != want:
    bad(f"nods_page_section holds {sections!r}, not a vector(768) section per heading with the build's token counts")

# ── indexing again embeds nothing; two at once embed the page once ─────────
s, again = index_docs()
if s != 200 or again != {"ok": True, "pages": 1, "embedded": [], "unchanged": [page["path"]], "failed": []}:
    bad(f"a second indexing answered {s} {again}")
sql("delete from nods_page")
results = []
def one():
    results.append(index_docs())
threads = [threading.Thread(target=one) for _ in range(2)]
for th in threads: th.start()
for th in threads: th.join()
embedded = sorted(len(r[1].get("embedded", [])) for r in results)
if [r[0] for r in results] != [200, 200] or embedded != [0, 1]:
    bad(f"two indexings at once answered {results}: want one to embed the page and the other to find it done")
if sql("select count(*) from nods_page_section") != str(len(page["sections"])):
    bad(f"two indexings at once left {sql('select count(*) from nods_page_section')} sections, not {len(page['sections'])}")

# ── a question about the docs, answered from the section ranked first ─────
s, ctype, answer = search("How do I store embeddings in Postgres with pgvector?")
if s != 200 or not ctype.startswith("text/plain"):
    bad(f"the search answered {s} {ctype}: {answer[:200]}")
elif answer != "From the docs: Storing Embeddings in Postgres":
    bad(f"the search answered {answer!r}: not from the pgvector section")

# ── one sharing nothing with the docs ─────────────────────────────────────
# Picked so that its word lands in no dimension the docs' words do in the
# stand-in's hashing — checked here, so a change to the docs cannot make it
# collide silently.
def fnv1a(w):
    h = 0x811c9dc5
    for c in w:
        h = ((h ^ ord(c)) * 0x01000193) & 0xFFFFFFFF
    return h
used = {fnv1a(w) % 768 for x in page["sections"] for w in re.findall(r"[a-z0-9]+", x["content"][:2000].replace("\n", " ").lower())}
unrelated = "zebra"
if fnv1a(unrelated) % 768 in used:
    bad(f"the unrelated question {unrelated!r} collides with the docs in the stand-in's hashing: pick another word")
s, _, answer = search(unrelated)
if answer != "Sorry, I don't know how to help with that.":
    bad(f"a question sharing nothing with the docs got {answer!r}")

# ── a request without a question, and an empty index ──────────────────────
s, _, body = req("/api/vector-search", b"{}", {"content-type": "application/json"}, "POST")
if s != 400 or json.loads(body) != {"error": "Missing query in request data", "data": {}}:
    bad(f"a search with no prompt answered {s} {body}")
sql("delete from nods_page")
s, ctype, answer = search("What is pgvector?")
if s != 200 or "has not been indexed yet" not in answer:
    bad(f"a search over an empty index answered {s} {answer!r}")
s, again = index_docs()
if s != 200 or again.get("embedded") != [page["path"]]:
    bad(f"re-indexing an emptied database answered {s} {again}")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print(f"   / as {name!r} linking github.com/{org}/{repo}, a 404, /api/health; the smoke indexed 1 page as "
      f"{len(page['sections'])} vector(768) sections; a second indexing embedded nothing, two at once embedded it "
      f"once; a question answered from the pgvector section, an unrelated one \"Sorry, I don't know how to help "
      f"with that.\", a prompt-less request refused, an empty index said so")
PY

# What the Workers AI stand-in was asked, read back from wrangler's output:
# the app embedded and answered through the AI binding, with the models it
# names, streaming every answer.
python3 - "$scratch/dev.log" <<'PY' || { echo "FAIL: the AI binding's calls" >&2; grep 'fake-workers-ai' "$scratch/dev.log" | tail -20 >&2; exit 1; }
import json, re, sys
calls = [json.loads(m.group(1)) for m in re.finditer(r"fake-workers-ai (\{.*\})", open(sys.argv[1]).read())]
problems = []
refused = [c for c in calls if "refused" in c]
embeds = [c for c in calls if c["model"] == "@cf/baai/bge-base-en-v1.5"]
answers = [c for c in calls if c["model"] == "@cf/meta/llama-4-scout-17b-16e-instruct"]
if refused:
    problems.append(f"the stand-in refused {refused}")
page_embeds = [c for c in embeds if len(c["texts"]) == 2]
question_embeds = [c for c in embeds if len(c["texts"]) == 1]
# The smoke's indexing, the one of the two concurrent indexings that
# embedded, the re-indexing after the empty index: three, each the page's two
# sections in one call. Then the two questions that reached the model.
if len(page_embeds) != 3 or len(question_embeds) != 2 or len(embeds) != 5:
    problems.append(f"{len(page_embeds)} page and {len(question_embeds)} question embeddings (of {len(embeds)}); want 3 and 2")
if len(answers) != 2 or not all(c.get("stream") for c in answers):
    problems.append(f"the answers were {answers}: want two, both streamed")
for p in problems:
    print(f"  ✕ {p}", file=sys.stderr)
if problems:
    sys.exit(1)
print(f"   the AI binding: {len(embeds)} embedding calls and {len(answers)} streamed answers, the models lib/ai/models.ts names")
PY

# ── 6. what Supabase's Data API would see ──────────────────────────────────
echo "── the Data API's roles (anon, authenticated) against the same database"
psql "$pgurl" -X -q -v ON_ERROR_STOP=1 -At > "$scratch/rls.out" 2> "$scratch/rls.err" <<'SQL' \
  || { echo "FAIL: the row-level security checks" >&2; cat "$scratch/rls.err" >&2; exit 1; }
SELECT 'app role: superuser=' || rolsuper || ' bypassrls=' || rolbypassrls FROM pg_roles WHERE rolname = current_user;
SELECT 'public tables without RLS: ' || count(*) FILTER (WHERE NOT c.relrowsecurity) || ' of ' || count(*)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'not owned by the app: ' || count(*) FILTER (WHERE pg_get_userbyid(c.relowner) <> current_user)
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p');
SELECT 'app sees pages: ' || count(*) FROM nods_page;
SELECT 'app sees sections: ' || count(*) FROM nods_page_section;
SET ROLE anon;
SELECT 'anon sees pages: ' || count(*) FROM nods_page;
SELECT 'anon sees sections: ' || count(*) FROM nods_page_section;
RESET ROLE;
SET ROLE authenticated;
SELECT 'authenticated sees pages: ' || count(*) FROM nods_page;
SELECT 'authenticated sees sections: ' || count(*) FROM nods_page_section;
RESET ROLE;
SQL
sed 's/^/   /' "$scratch/rls.out"
grep -qx "app role: superuser=false bypassrls=false" "$scratch/rls.out" \
  && grep -qE "^public tables without RLS: 0 of [1-9][0-9]*$" "$scratch/rls.out" \
  && grep -qx "not owned by the app: 0" "$scratch/rls.out" \
  || { echo "FAIL: the app's role, the tables' owner or their row-level security is not what Supabase's would be" >&2; exit 1; }
for line in "app sees pages: 1" "app sees sections: 2" \
            "anon sees pages: 0" "anon sees sections: 0" \
            "authenticated sees pages: 0" "authenticated sees sections: 0"; do
  grep -qx "$line" "$scratch/rls.out" || { echo "FAIL: expected '$line'" >&2; exit 1; }
done
for role in anon authenticated; do
  # A write through the Data API's roles is refused by row-level security …
  if psql "$pgurl" -X -q -At -c "SET ROLE $role; INSERT INTO nods_page (path) VALUES ('/$role')" > "$scratch/rls-write.log" 2>&1; then
    echo "FAIL: $role wrote a page through row-level security" >&2; exit 1
  fi
  grep -q "row-level security" "$scratch/rls-write.log" \
    || { echo "FAIL: $role's write was refused for another reason:" >&2; cat "$scratch/rls-write.log" >&2; exit 1; }
  # … and the search function, which the Data API would serve as an RPC, is
  # not theirs to call (030).
  if psql "$pgurl" -X -q -At -c "SET ROLE $role; SELECT count(*) FROM match_page_sections(array_fill(0, array[768])::vector, -1, 10, 0)" > "$scratch/rls-fn.log" 2>&1; then
    echo "FAIL: $role called match_page_sections()" >&2; exit 1
  fi
  grep -q "permission denied for function match_page_sections" "$scratch/rls-fn.log" \
    || { echo "FAIL: $role's call was refused for another reason:" >&2; cat "$scratch/rls-fn.log" >&2; exit 1; }
done
echo "   anon and authenticated, granted what Supabase grants them, read the index as empty, write nothing and call no function; the app reads and writes it as its owner"

echo "e2e.test.sh: ok"
