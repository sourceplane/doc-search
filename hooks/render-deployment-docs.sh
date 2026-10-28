#!/usr/bin/env bash
# Render the product's LIVE-DEPLOYMENT documentation from verified state.
# Called by phase 02-docs as a `run:` hook (and safe to run by hand, from the
# product's checkout). Idempotent: the generated file and the README section
# are fully re-rendered on every run, so re-running after a redeploy, a custom
# domain or adding OpenAI for the answers refreshes them.
#
#   hooks/render-deployment-docs.sh <out> <workspace> <baseline-dir>
#
# What it writes (in <out>):
#   ai/context/deployment.md   — REGENERATED: URLs with live probe results
#                                (the app, its database check, how much of
#                                the docs is indexed, which model writes the
#                                answers), identity, and the secrets
#                                the deployment uses BY NAME
#   ai/context/operations.md   — healed from the baseline's copy if absent
#                                (the static operating contract; never rewritten)
#   README.md                  — the section between <!-- 02-docs:begin/end -->
#                                is replaced (appended after the title if the
#                                README predates the markers)
#
# No secret VALUE is ever read or written here — secrets are named, not read.
#
# IT ASKS THE PLATFORM NOTHING. The record used to carry the workspace's slug,
# its secrets listed per rung and its integrations — five CLI calls, one after
# another, from the build box — and all of it is what the console shows live
# and this file could only show as it was the day it was written. The record
# keeps what the repository is the right place for: the identity the code
# names, what answered at the URLs, and where to look for the rest.
set -euo pipefail

out="${1:?usage: render-deployment-docs.sh <out> <workspace> <baseline-dir>}"
ws="${2:-}"
L="${3:?usage: render-deployment-docs.sh <out> <workspace> <baseline-dir>}"

cd "$out"
vals=".rebrand/values.json"
[ -f "$vals" ] || { echo "render-docs: $vals missing — is this a bootstrapped product?" >&2; exit 1; }
val() { python3 -c "import json,sys;print(json.load(open('$vals')).get(sys.argv[1],'') or '')" "$1"; }

repo="$(val reponame)"
brand="$(val brandSlug)"; [ -n "$brand" ] || brand="$repo"
sub="$(val subdomain)"; [ -n "$sub" ] || sub="your-workers-subdomain"
[ -n "$ws" ] || ws="$(sed -n 's/^[[:space:]]*workspace:[[:space:]]*\([^[:space:]#]*\).*/\1/p' intent.yaml | head -1)"
[ -n "$ws" ] || ws="?"

# CI lane pin (what version the deploy lanes run).
lanepin="$(sed -n 's/^ *version: *\(v[0-9.]*\) *$/\1/p' .github/workflows/ci.yml 2>/dev/null | head -1)"
[ -n "$lanepin" ] || lanepin="?"

# curl emits the -w format even on connection failure (000) — capture, don't
# append, or a failed probe reads "000000".
probe() { local c; c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$1" 2>/dev/null)" || true; printf '%s' "${c:-000}"; }
badge() { case "$1" in 2*|3*) echo "LIVE ($1)" ;; 000) echo "unreachable" ;; *) echo "answering $1" ;; esac; }

stage_url="https://${brand}-web-stage.${sub}.workers.dev"
prod_url="https://${brand}-web-prod.${sub}.workers.dev"

# What /api/health reports, read only from a check that answered 200 (anything
# else says nothing): `answers` — "workers-ai" (the default, through the
# Worker's AI binding) or "openai" (the environment's Worker has an
# OPENAI_API_KEY: README, "Use OpenAI for the answers") — and how much of the
# docs is indexed (`pages`, `sections`: the deploy's smoke indexes them). The
# embeddings are Workers AI's either way.
health_field() { # URL FIELD
  local page code
  page="$(mktemp)"
  code="$(curl -s -o "$page" -w '%{http_code}' --max-time 20 "$1/api/health" 2>/dev/null)" || true
  code="${code:-000}"
  if [ "$code" != 200 ]; then echo "unknown (/api/health $(badge "$code"))"; rm -f "$page"; return; fi
  python3 -c "import json,sys;print(json.load(open(sys.argv[1])).get(sys.argv[2],''))" "$page" "$2" 2>/dev/null || echo ""
  rm -f "$page"
}
model_state() {
  local answers
  answers="$(health_field "$1" answers)"
  if [ "$answers" = workers-ai ]; then echo "Workers AI (the AI binding) — no vendor key set"
  elif [ "$answers" = openai ]; then echo "OpenAI's model — OPENAI_API_KEY is set"
  else echo "${answers:-unknown}"; fi
}
index_state() {
  local pages sections
  pages="$(health_field "$1" pages)"; sections="$(health_field "$1" sections)"
  case "$pages" in unknown*) echo "$pages"; return;; esac
  echo "${pages:-?} page(s), ${sections:-?} section(s)"
}

rows=""
for pair in "stage|$stage_url" "prod|$prod_url"; do
  env="${pair%%|*}"; url="${pair#*|}"
  rows+="| app (${env}) | ${url} | $(badge "$(probe "$url/")") |"$'\n'
  rows+="| database check (${env}) | ${url}/api/health | $(badge "$(probe "$url/api/health")") |"$'\n'
done
model_stage="$(model_state "$stage_url")"; model_prod="$(model_state "$prod_url")"
index_stage="$(index_state "$stage_url")"; index_prod="$(index_state "$prod_url")"

now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Heal the static operating contract when the product predates it.
mkdir -p ai/context
if [ ! -f ai/context/operations.md ] && [ -f "$L/ai/context/operations.md" ]; then
  cp "$L/ai/context/operations.md" ai/context/operations.md
  git add ai/context/operations.md 2>/dev/null || true
  node "$L/tooling/rebrand/rebrand.mjs" --values "$vals" --allow-dirty >/dev/null 2>&1 || true
  echo "render-docs: healed ai/context/operations.md"
fi

cat > ai/context/deployment.md <<EOF
# ${repo} — live deployment manifest

> GENERATED by the \`02-docs\` phase on ${now}; re-run it to refresh
> (idempotent; see [operations.md](operations.md)). Hand-edits here are
> overwritten. No secret values appear in this file — secrets are named only.

## Identity

| | |
|---|---|
| repository / project slug | \`${repo}\` |
| Orun workspace | \`${ws}\` |
| declared in | \`intent.yaml\` → \`execution.state.workspace\` |
| Workers | \`${brand}-web-stage\`, \`${brand}-web-prod\` on \`${sub}.workers.dev\` |
| CI lane CLI pin | orun \`${lanepin}\` (\`.github/workflows/ci.yml\`) |

## Public URLs (probed ${now})

| surface | URL | status |
|---|---|---|
${rows}
\`/api/health\` answers 200 only when the Worker reaches the Supabase database
through its Hyperdrive binding and the migrations are applied — the
embedding column at the embedding model's size included. It calls no model.
The \`dev\` environment is verify-only by design — no deployed URL.

## The docs index and the models

| environment | indexed | answers |
|---|---|---|
| stage | ${index_stage} | ${model_stage} |
| prod | ${index_prod} | ${model_prod} |

Every deploy's smoke indexes the docs the Worker was built with (\`POST
/api/embeddings\`: only the pages whose checksum the database does not hold).
Embeddings are Workers AI's \`@cf/baai/bge-base-en-v1.5\` (768 dimensions)
in both, through the Worker's AI binding: the index's column is sized to
that model. Workers AI bills the Cloudflare account the Worker runs in, after
its free daily allocation. No AI vendor is brokered by the platform: OpenAI
for the answers is a Worker secret the owner adds per environment (README,
"Use OpenAI for the answers").

## Secrets (names only)

| secret | where | what it is |
|---|---|---|
| \`CLOUDFLARE_API_TOKEN\` | the workspace | BROKERED from its Cloudflare connection (\`workers-deploy\`): deploys the app's Worker, its static assets and its Workers AI binding |
| \`CLOUDFLARE_HYPERDRIVE_TOKEN\` | the workspace | BROKERED (\`hyperdrive-edit\`): applies the Hyperdrive config — the deploy token cannot touch Hyperdrive |
| \`CLOUDFLARE_ACCOUNT_ID\` | the workspace | the Cloudflare connection's account id — a fact, not a credential |
| \`SUPABASE_ACCESS_TOKEN\` | the workspace | BROKERED from its Supabase connection (\`management-access\`): creates the project and runs the migrations |
| \`SUPABASE_ORG_ID\` | the workspace | the Supabase connection's organization id — a fact, not a credential |
| \`SUPABASE_PROJECT_REF\`, \`SUPABASE_DB_PASSWORD\`, \`SUPABASE_DB_URL\` | \`${repo}\` on stage and on prod | written by the Supabase root's apply: the project's ref, its database password and its connection URL, read by Hyperdrive and the migrations |
| \`WIRING_CLOUDFLARE_HYPERDRIVE\` | \`${repo}\` on stage and on prod | written by the Hyperdrive root's apply: the config's id and name, not a credential |

Brokered secrets are minted per run, so no long-lived value is at rest. No
AI vendor key is a workspace secret: OpenAI's key, if the owner adds it, is
a Worker secret (above). What the workspace holds right now (every secret by name,
and its integrations and their health) is on the console's Secrets and
Integrations pages for \`${ws}\`.

## How this deployment changes

Merges to \`main\` converge automatically: CI plans the changed components and
runs each lane with \`orun run --remote-state\` against the workspace above.
See [operations.md](operations.md) for the full operating contract.
EOF
echo "render-docs: wrote ai/context/deployment.md"

python3 - <<'PY'
import re
begin, end = "<!-- 02-docs:begin -->", "<!-- 02-docs:end -->"
body = f"""{begin}
This product is **live**. Verified URLs, identity, the docs index, the answer model
and the secrets it uses are recorded in
[ai/context/deployment.md](ai/context/deployment.md) (re-rendered by the
`02-docs` phase); how it deploys and how to operate it:
[ai/context/operations.md](ai/context/operations.md).
{end}"""
s = open("README.md").read()
if begin in s and end in s:
    s = re.sub(re.escape(begin) + r".*?" + re.escape(end), lambda _m: body, s, count=1, flags=re.S)
else:
    lines = s.splitlines(keepends=True)
    at = 1
    while at < len(lines) and lines[at].strip() == "":
        at += 1
    lines.insert(at, f"\n## Live deployment\n\n{body}\n")
    s = "".join(lines)
open("README.md", "w").write(s)
print("render-docs: README live-deployment section rendered")
PY
echo "render-docs: done"
