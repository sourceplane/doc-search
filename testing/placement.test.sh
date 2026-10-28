#!/usr/bin/env bash
# TIER 1 — the tree is placed, branded, and made to answer.
#
# A real bootstrap is `orun new --run-hooks --resume` against a workspace: it
# places each phase, runs that phase's hooks, lands a pull request and watches
# the convergence. Everything in that sentence except the platform can run
# here, offline, and this file runs it:
#
#   1. the whole blueprint placed in one go — orun runs `validate` and
#      `plan --dry-run` inside the produced tree and says so; asserted, because
#      a future orun that stopped running them would weaken this tier in silence;
#   2. THE OFFLINE BOOTSTRAP (testing/lib/bootstrap.sh) — both phases placed in
#      order, each finished by the blueprint's OWN `run:` hooks (the retouch
#      marker, rebrand, re-tenant, work-tree strip, the deferrals and their
#      restore, the deployment record), each landing a commit;
#   3. the product it ends with: branded with no residue, carrying nothing of
#      the factory and naming none of it, re-tenanted, its gates restored, its
#      record rendered, its wrangler config committed;
#   4. what the product's own CI does with the 01-product merge: `orun plan
#      --trigger github-push-main` over exactly that commit. Per environment:
#      supabase → cloudflare-hyperdrive → db-migrate → web, every edge
#      ENFORCED, read off the plan's own dependency graph; stage and prod side
#      by side; nothing on dev; every brokered key the plan resolves minted by
#      the blueprint, and every other the infrastructure publishes. The same
#      commit planned as a pull request: every one of those edges advisory;
#   5. after 02-docs: prod waits on stage again and dev verifies main again;
#   6. a `--resume` over the finished product places nothing and un-brands
#      nothing.
#
# testing/e2e.test.sh goes on from here: it installs, migrates, builds and
# serves the product, indexes its docs through the deployed Worker's own
# smoke command, and has a question answered from them.
#
# Needs: orun, node, pnpm, python3 (+PyYAML), git. No credential. The
# deployment-record probes reach the network if they can, and pass without it.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"
# shellcheck source=lib/bootstrap.sh
source "$here/lib/bootstrap.sh"

for bin in orun node pnpm python3 git; do
  command -v "$bin" >/dev/null || { echo "placement.test.sh needs $bin on PATH" >&2; exit 1; }
done

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
fails=0
fail() { echo "  ✕ $*" >&2; fails=$((fails + 1)); }
values="$here/fixtures/acme.json"
repo="$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['reponame'])" "$values")"

sets=()
while IFS=$'\t' read -r k v; do sets+=( --set "$k=$v" ); done < <(
  python3 - "$values" <<'PY'
import json, sys
for k, v in json.load(open(sys.argv[1])).items():
    if not k.startswith("_"):
        print(f"{k}\t{'true' if v is True else 'false' if v is False else v}")
PY
)

# ── 1. the whole blueprint, one placement ──────────────────────────────────
echo "── placing the whole blueprint at once (offline, no credential)"
whole="$scratch/whole"
mkdir -p "$whole"
if ! orun new --blueprint "$root/repo-blueprint.yaml" --out "$whole" "${sets[@]}" > "$scratch/whole.log" 2>&1; then
  echo "FAIL: the placement did not run" >&2; tail -20 "$scratch/whole.log" >&2; exit 1
fi
# The line's wording moved between orun releases (v2.58: `repo gate: validate +
# plan --dry-run passed`; v2.79: `Verified  intent valid · N components …`).
grep -Eq "repo gate: validate \+ plan --dry-run passed|Verified +intent valid" "$scratch/whole.log" \
  || fail "the placement did not report the repo-scale gate (orun validate + plan --dry-run inside the tree)"
n="$(find "$whole" -type f -not -path '*/.orun/*' | wc -l | tr -d ' ')"
[ "$n" -ge 100 ] || fail "only $n files placed — that is not a product"
[ "$fails" -eq 0 ] && echo "   $n files placed into an empty directory; the repo-scale gate ran"

# ── 2. the offline bootstrap ───────────────────────────────────────────────
echo "── the offline bootstrap: both phases, their own hooks, a landing each"
tree="$scratch/$repo"     # named as the repository is: orun names the project after it
bootstrap_offline "$root" "$tree" "$values" "$scratch/logs" > "$scratch/bootstrap.log" 2>&1 || {
  echo "FAIL: the offline bootstrap stopped" >&2; tail -40 "$scratch/bootstrap.log" >&2; exit 1; }
grep -E '^── ' "$scratch/bootstrap.log" | sed 's/^/  /'
commits="$(git -C "$tree" rev-list --count HEAD)"
[ "$commits" = 2 ] || fail "the bootstrap landed $commits commits, not one per phase (2)"

# ── 3. the product it ends with ────────────────────────────────────────────
echo "── the product it produced"
(cd "$tree" && node "$root/tooling/rebrand/rebrand.mjs" --verify --values .rebrand/values.json) > "$scratch/verify.log" 2>&1 \
  || { fail "rebrand --verify found the baseline's identity in the product:"; sed 's/^/      /' "$scratch/verify.log" >&2; }

python3 - "$tree" "$values" "$root" <<'PY' || fails=$((fails + 1))
import json, pathlib, re, subprocess, sys
import yaml
tree, values, root = pathlib.Path(sys.argv[1]), json.load(open(sys.argv[2])), pathlib.Path(sys.argv[3])
problems = []
def bad(m): problems.append(m)
repo, org, name, sub, ws = (values[k] for k in ("reponame", "githuborg", "productname", "subdomain", "orunWorkspace"))

tracked = subprocess.run(["git", "ls-files"], cwd=tree, capture_output=True, text=True, check=True).stdout.split()

# Nothing of the factory, nothing local, exactly the two context pages.
NEVER = (".baseline/", "specs/", "tasks/", "testing/", "hooks/", "docs/phases/",
         "tooling/rebrand/", "tooling/bootstrap/", ".github/workflows/baseline.yml",
         ".github/workflows/tag.yml", "BOOTSTRAP.md", "repo-blueprint.yaml", "blueprint.yaml")
for p in tracked:
    if any(p == n or p.startswith(n) for n in NEVER):
        bad(f"{p} is in the product — it is the factory")
    if re.search(r"(^|/)(\.env(\.local)?|\.dev\.vars|node_modules|\.orun|\.next|\.open-next|\.terraform)(/|$)", p):
        bad(f"{p} is in the product — a local or built file")
ai = {p for p in tracked if p.startswith("ai/")}
if ai != {"ai/context/deployment.md", "ai/context/operations.md"}:
    bad(f"ai/ in the product is {sorted(ai)}")

# …and no tracked file names one of the factory's paths.
FACTORY_PATH = re.compile(r"repo-blueprint|(?<![\w./-])(?:testing|specs|tasks|\.baseline|docs/phases)/"
                          r"|BOOTSTRAP\.md|tooling/(?:rebrand|bootstrap)\b")
for p in tracked:
    try:
        text = (tree / p).read_text()
    except (UnicodeDecodeError, IsADirectoryError):
        continue
    for n, line in enumerate(text.splitlines(), 1):
        if FACTORY_PATH.search(line):
            bad(f"{p}:{n} names the factory: {line.strip()[:80]}")

# The identity, where the product carries it.
site = (tree / "apps/web/lib/site.ts").read_text()
if f"SITE_NAME = {json.dumps(name)}" not in site:
    bad(f"apps/web/lib/site.ts does not name the product {name!r}")
comp = yaml.safe_load((tree / "apps/web/component.yaml").read_text())["spec"]
params = comp["parameters"]
if params["workerName"] != f"{repo}-web":
    bad(f"workerName is {params['workerName']}, not {repo}-web")
if params["workersDevSubdomain"] != sub:
    bad(f"workersDevSubdomain is {params['workersDevSubdomain']}, not {sub}")
if json.loads((tree / "package.json").read_text())["name"] != repo:
    bad("package.json is not named for the product")
for comp_path in ("apps/web", "infra/terraform/supabase", "infra/terraform/cloudflare-hyperdrive", "infra/db-migrate"):
    doc = yaml.safe_load((tree / comp_path / "component.yaml").read_text())["spec"]
    for k, ref in (doc.get("secretEnv") or {}).items():
        if not ref.startswith(f"secret://{ws}/{repo}/"):
            bad(f"{comp_path} {k} resolves from {ref} — not the product's workspace and project")

# The upstream's own name survives the rename: its repository,
# supabase-community/nextjs-openai-doc-search, ends in the baseline's slug —
# and this product's own source link is renamed to the product's repository.
app_readme = (tree / "apps/web/README.md").read_text()
if "github.com/supabase-community/nextjs-openai-doc-search" not in app_readme:
    bad("apps/web/README.md's credit to the upstream repository was renamed")
if f'SOURCE_URL = "https://github.com/{org}/{repo}"' not in site:
    bad(f"apps/web/lib/site.ts does not link the product's own repository github.com/{org}/{repo}")
# The docs index is committed and must still match the docs after the rename
# (the deploy embeds it; tests/web fails a stale one).
idx = json.loads((tree / "apps/web/lib/docs/index.generated.json").read_text())
if [p["path"] for p in idx["pages"]] != ["/docs/openai_embeddings"]:
    bad("the placed docs index does not carry upstream's sample doc")

# The wrangler config is committed, and is the fixture render of the
# (rebranded) template — the composition checks it exists before the build.
if "apps/web/wrangler.jsonc" not in tracked:
    bad("apps/web/wrangler.jsonc is not committed — verify-app-structure would fail in every lane")
else:
    rendered = tree / "wrangler.check.jsonc"
    subprocess.run(["node", "tooling/wire/render.mjs", "--template", "apps/web/wrangler.template.jsonc",
                    "--out", str(rendered), "--map", "apps/web/wiring.fixture.json", "--env", "stage"],
                   cwd=tree, check=True, capture_output=True)
    if rendered.read_text() != (tree / "apps/web/wrangler.jsonc").read_text():
        bad("apps/web/wrangler.jsonc is not the fixture render of its template")
    if f'"name": "{repo}-web"' not in rendered.read_text():
        bad("the committed wrangler config does not carry the product's Worker name")
    if not re.search(r'"ai":\s*\{\s*"binding":\s*"AI"\s*\}', rendered.read_text()):
        bad("the committed wrangler config does not bind Workers AI as AI")
    rendered.unlink()

# The intent: re-tenanted, no work tree, both gates back.
intent_text = (tree / "intent.yaml").read_text()
intent = yaml.safe_load(intent_text)
if intent["metadata"]["name"] != repo:
    bad(f"intent metadata.name is {intent['metadata']['name']}")
if intent["execution"]["state"]["workspace"] != ws:
    bad(f"intent workspace is {intent['execution']['state']['workspace']}, not the product's")
if "work" in intent:
    bad("intent.yaml still declares the baseline's work tree")
if "promotion" not in intent["environments"]["prod"] or "@promotion-deferred" in intent_text:
    bad("prod's promotion gate was not restored by 02-docs")
if "github-push-main" not in intent["environments"]["dev"]["activation"]["triggerRefs"] or "@dev-lanes-deferred" in intent_text:
    bad("dev's push activation was not restored by 02-docs")
for env in ("stage", "prod"):
    want = f"https://{repo}-web-{env}.{sub}.workers.dev"
    if intent["environments"][env].get("url") != want:
        bad(f"environments.{env}.url is {intent['environments'][env].get('url')}, not {want}")
    if intent["environments"][env]["parameterDefaults"]["terraform"]["repo"] != repo:
        bad(f"environments.{env} names the Supabase project after another repo")
for page in (intent.get("repo") or {}).get("docs", {}).get("pages", []):
    if not (tree / page["path"]).exists():
        bad(f"intent repo.docs names {page['path']}, which the product does not have")

# The landings, as the phases made them: a redeploy marker on every
# component 01-product's contract names, the record rendered by 02-docs.
contract = yaml.safe_load((root / ".baseline/tasks/01-product.TaskContract.yaml").read_text())
for comp_name in contract["spec"]["affects"]:
    hits = [p for p in tracked if p.endswith("component.yaml")
            and (yaml.safe_load((tree / p).read_text()) or {}).get("metadata", {}).get("name") == comp_name]
    if len(hits) != 1 or not re.search(r"^# orun: redeploy 01-product \S+$", (tree / hits[0]).read_text(), re.M):
        bad(f"component {comp_name} carries no 01-product redeploy marker")
dep = (tree / "ai/context/deployment.md").read_text()
if "GENERATED by the `02-docs` phase" not in dep or f"https://{repo}-web-prod.{sub}.workers.dev" not in dep \
        or "/api/health" not in dep or "## The docs index and the models" not in dep:
    bad("ai/context/deployment.md was not rendered for the product")
readme = (tree / "README.md").read_text()
if not readme.startswith(f"# {repo}\n") or "This product is **live**" not in readme:
    bad("README.md is not the product's, or its live-deployment section was not rendered")

# Provenance prose, over the BRANDED files.
PROV = re.compile(r"\bfork(ed)? (of|from)\b|\bbaseline (repo|repository|commit|tag)\b|repo-blueprint|BOOTSTRAP\.md", re.I)
for rel in ("README.md", "ai/context/operations.md", "ai/context/deployment.md"):
    for n, line in enumerate((tree / rel).read_text().splitlines(), 1):
        if PROV.search(line):
            bad(f"{rel}:{n} speaks of the factory: {line.strip()[:70]}")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print(f"   {len(tracked)} tracked files; branded, re-tenanted, naming nothing of the factory, gates restored, record rendered")
PY

# ── 4. the product's own CI, over the 01-product merge ─────────────────────
echo "── orun plan in the product, for the push that merged 01-product"
s01="$(git -C "$tree" rev-parse HEAD~1)"
# A clone, so the bootstrap's own tree is never moved: at the 01-product
# commit (promotion and dev's push lanes still deferred), with an empty branch
# beside it to plan a pull request against. Named as the repository is.
mkdir -p "$scratch/at-01"
git clone -q "$tree" "$scratch/at-01/$repo"
at01="$scratch/at-01/$repo"
git -C "$at01" checkout -q --orphan empty
git -C "$at01" rm -rqf .
git -C "$at01" -c user.email=t@example.invalid -c user.name=t commit -qm empty --allow-empty
git -C "$at01" checkout -q "$s01"
(cd "$at01" && orun validate --intent intent.yaml) > "$scratch/validate.log" 2>&1 \
  || { fail "orun validate refused the product's intent at 01-product"; tail -10 "$scratch/validate.log" >&2; }
# The merge is the repository's first content: every file is new, so the
# push's `--changed` set is every component — the full plan.
(cd "$at01" && orun plan --intent intent.yaml --trigger github-push-main --output "$scratch/plan-main.json") > "$scratch/plan-main.log" 2>&1 \
  || { fail "orun plan (push to main) failed in the product at 01-product"; tail -15 "$scratch/plan-main.log" >&2; }
(cd "$at01" && orun plan --intent intent.yaml --trigger github-pull-request --base empty --head HEAD \
   --output "$scratch/plan-pr.json") > "$scratch/plan-pr.log" 2>&1 \
  || { fail "orun plan (pull request) failed in the product at 01-product"; tail -15 "$scratch/plan-pr.log" >&2; }

# The PRODUCT's CI plans with its own lane pin (ci.yml), not with the orun
# that places the blueprint: per-edge `modeRules` — advisory on a pull
# request — are read by that pin, and an orun older than it (v2.58.11, the
# bootstrap's floor before v2.88.0) plans them enforced everywhere. So the
# pull-request half below holds only when this orun is at least the
# product's pin — which the floor now is; e2e.test.sh asserts it again.
lane_pin="$(sed -n 's/^ *version: *v\([0-9.]*\) *$/\1/p' "$tree/.github/workflows/ci.yml" | head -1)"
this_orun="$(orun --version | sed -n 's/.*version v\{0,1\}\([0-9.]*\).*/\1/p' | head -1)"

python3 - "$scratch/plan-main.json" "$scratch/plan-pr.json" "$values" "$root" "$at01" "$this_orun" "$lane_pin" <<'PLAN' || fails=$((fails + 1))
import json, pathlib, sys
import yaml
plan, pr = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
values, root, tree = json.load(open(sys.argv[3])), pathlib.Path(sys.argv[4]), pathlib.Path(sys.argv[5])
this_orun, lane_pin = (tuple(int(x) for x in v.split(".")) for v in sys.argv[6:8])
repo, sub, ws = values["reponame"], values["subdomain"], values["orunWorkspace"]
problems = []
def bad(m): problems.append(m)
jobs = {(j["component"], j["environment"]): j for j in plan["jobs"]}
ids = {j["id"]: j for j in plan["jobs"]}

CHAIN = ["supabase", "cloudflare-hyperdrive", "db-migrate", "web"]
PROFILE = {"supabase": "terraform.apply", "cloudflare-hyperdrive": "terraform.apply",
           "db-migrate": "db-migrate.apply", "web": "cloudflare-workers-assets-turbo.deploy",
           "db": "turbo-package.quick-check"}
want = {(c, e) for c in PROFILE for e in ("stage", "prod")}
if set(jobs) != want:
    bad(f"the 01-product merge plans {sorted(jobs)}; it must plan {sorted(want)} — and nothing on dev")
for (comp, env), j in jobs.items():
    if comp in PROFILE and j["profile"] != PROFILE[comp]:
        bad(f"{comp}@{env} plans {j['profile']}, not {PROFILE[comp]}")
    if j.get("dependencyMode") != "enforced":
        bad(f"{j['id']} plans dependencyMode {j.get('dependencyMode')}, not enforced")
    for dep in j.get("dependsOn") or []:
        if ids[dep]["environment"] != j["environment"]:
            bad(f"{j['id']} waits on {dep} — during the bootstrap stage and prod run side by side")

# THE ORDER, read off the plan's own graph: each link of the chain is an
# ENFORCED edge (`dependsOn`, not `advisoryDependsOn`), and the depth of each
# job — the longest chain of enforced edges into it — puts the four on four
# different levels, in order.
depth = {}
def level(jid):
    if jid not in depth:
        depth[jid] = 1 + max((level(d) for d in ids[jid].get("dependsOn") or []), default=-1)
    return depth[jid]
for env in ("stage", "prod"):
    by = {c: jobs.get((c, env)) for c in CHAIN}
    if not all(by.values()):
        continue
    for a, b in zip(CHAIN, CHAIN[1:]):
        if by[a]["id"] not in (by[b].get("dependsOn") or []):
            bad(f"{b}@{env} does not wait on {a}@{env} — the order is {' → '.join(CHAIN)}")
    for dep in ("cloudflare-hyperdrive", "db-migrate"):
        if by[dep]["id"] not in (by["web"].get("dependsOn") or []):
            bad(f"web@{env} reads {dep}'s output and does not wait on it")
    order = sorted(CHAIN, key=lambda c: level(by[c]["id"]))
    levels = [level(by[c]["id"]) for c in order]
    if order != CHAIN or len(set(levels)) != len(levels):
        bad(f"{env} converges {order} at levels {levels}; it must be {' → '.join(CHAIN)}, one after another")
    else:
        print(f"   {env}, enforced: " + " → ".join(order))

# …and on a pull request every one of those edges is ADVISORY: nothing is
# applied or deployed there, so nothing waits.
prj = {(j["component"], j["environment"]): j for j in pr["jobs"]}
pr_edges = this_orun >= lane_pin
for env in ("stage", "prod"):
    for a, b in zip(CHAIN, CHAIN[1:]) if pr_edges else ():
        jb, ja = prj.get((b, env)), prj.get((a, env))
        if not ja or not jb:
            bad(f"the pull-request plan has no {a}@{env} or {b}@{env}")
            continue
        if ja["id"] in (jb.get("dependsOn") or []):
            bad(f"on a pull request {b}@{env} still waits on {a}@{env} — the edge must be advisory there")
        if ja["id"] not in (jb.get("advisoryDependsOn") or []):
            bad(f"on a pull request {b}@{env} does not name {a}@{env} as advisory")
    for comp, prof in (("supabase", "plan-only"), ("cloudflare-hyperdrive", "plan-only"),
                       ("db-migrate", "plan"), ("web", "verify")):
        j = prj.get((comp, env))
        if j and not j["profile"].endswith("." + prof):
            bad(f"on a pull request {comp}@{env} plans {j['profile']}, which may mutate")
if pr_edges:
    print("   pull request: the same edges, advisory; plan-only, plan and verify — nothing applied")
else:
    print(f"   pull request: plan-only, plan and verify — nothing applied (the edges' advisory mode is "
          f"read by the product's lane pin v{'.'.join(map(str, lane_pin))}; this orun is "
          f"v{'.'.join(map(str, this_orun))} — not checked here)")

# Every brokered key the plan resolves is one the blueprint mints, and every
# other key it resolves is one an apply publishes — nothing else. Derived
# from the product's own plan (component secretEnv AND the compositions'
# bindings), the blueprint's reconcile hooks and the components' secretOutputs.
bp = yaml.safe_load((root / "repo-blueprint.yaml").read_text())
# Either form a reconcile takes: `secrets: [{key, template}]`, or `keys`.
minted = {k for p in bp["phases"] for slot in (p.get("hooks") or {}).values() for h in slot
          if (h.get("uses") or "").startswith("orun.integrations/reconcile@")
          for k in [s["key"] for s in h["with"].get("secrets") or []] + list(h["with"].get("keys") or [])}
published = set()
for comp in tree.glob("infra/**/component.yaml"):
    so = str(((yaml.safe_load(comp.read_text()) or {}).get("spec") or {}).get("parameters", {}).get("secretOutputs") or "")
    published |= {pair.split("=", 1)[0] for pair in so.split(",") if "=" in pair}
resolved = set()
# The one key an OWNER stores, neither minted nor published: REINDEX_TOKEN,
# the bearer refresh=1 needs. Only web resolves it, this environment's, and
# BEST-EFFORT — a key nobody has stored is skipped, so the product deploys.
owner_keys = {"REINDEX_TOKEN"}
for (comp, env), j in jobs.items():
    for r in j.get("secretRefs") or []:
        ref = r["ref"]
        key = ref.rsplit("/", 1)[1]
        if key in owner_keys:
            if comp != "web" or ref != f"secret://{ws}/{repo}/{env}/{key}" or r.get("optional") is not True:
                bad(f"{comp}@{env} resolves {key} as {r} — want web's optional secret://{ws}/{repo}/{env}/{key}")
            continue
        if r.get("optional"):
            bad(f"{comp}@{env} resolves {r['asEnv']} as optional; only {sorted(owner_keys)} may be")
        resolved.add(key)
        if not ref.startswith(f"secret://{ws}/"):
            bad(f"{comp}@{env} resolves {r['asEnv']} from {ref} — not the product's workspace")
        if f"/{repo}/" not in ref and f"project:{repo}/" not in ref:
            bad(f"{comp}@{env} resolves {r['asEnv']} from {ref} — not the product's project")
if resolved - published != minted:
    bad(f"the plan resolves brokered keys {sorted(resolved - published)}; the blueprint mints {sorted(minted)}")
if not published <= resolved:
    bad(f"the infrastructure publishes {sorted(published - resolved)} and nothing reads it")
print(f"   the plan resolves exactly the {len(minted)} keys the blueprint mints, "
      f"and reads all {len(published)} the applies publish")

# The deploy itself: the structure check, the live wiring render, the
# Worker's name, the smoke.
for env in ("stage", "prod"):
    j = jobs.get(("web", env))
    if not j:
        continue
    steps = {s["id"]: s.get("run") or "" for s in j["steps"]}
    for need in ("verify-app-structure", "build-app", "deploy", "smoke"):
        if need not in steps:
            bad(f"web@{env} has no {need} step")
    if 'test -f "wrangler.jsonc"' not in steps.get("verify-app-structure", ""):
        bad(f"web@{env} checks another config before the build: {steps.get('verify-app-structure','').strip()}")
    if "tooling/wire/live.mjs" not in steps.get("build-app", "") or "cloudflare-hyperdrive" not in steps.get("build-app", ""):
        bad(f"web@{env} does not render its wrangler config from the Hyperdrive wiring before it builds")
    if f'EFFECTIVE_WORKER_NAME="{repo}-web-{env}"' not in steps.get("deploy", ""):
        bad(f"web@{env} deploys a Worker not named {repo}-web-{env}")
    if "/api/health" not in steps.get("smoke", "") or f'export WORKERS_DEV_SUBDOMAIN="{sub}"' not in steps.get("smoke", ""):
        bad(f"web@{env}'s smoke does not check the product's own /api/health")
    if "-X POST" not in steps.get("smoke", "") or "/api/embeddings" not in steps.get("smoke", ""):
        bad(f"web@{env}'s smoke does not index the docs (POST /api/embeddings)")
    if not any(r["asEnv"] == "REINDEX_TOKEN" and r.get("optional") is True for r in j.get("secretRefs") or []):
        bad(f"web@{env} does not resolve the owner's REINDEX_TOKEN (optional)")
    if "env -u REINDEX_TOKEN" not in steps.get("build-app", "") \
            or f'worker-secrets.mjs --secret REINDEX_TOKEN --worker "{repo}-web-${{ORUN_ENVIRONMENT}}"' not in steps.get("build-app", ""):
        bad(f"web@{env}'s build does not keep REINDEX_TOKEN out of the bundle and hand it to its own Worker")

if problems:
    for p in problems:
        print(f"  ✕ {p}", file=sys.stderr)
    sys.exit(1)
print("   stage and prod side by side; nothing on dev; the Worker, its wiring render and its smoke the product's own")
PLAN

# ── 5. after the record: the gates are back ────────────────────────────────
echo "── orun plan in the finished product: prod waits on stage, dev verifies main"
(cd "$tree" && orun plan --intent intent.yaml --trigger github-push-main --output "$scratch/plan-after.json") > "$scratch/plan-after.log" 2>&1 \
  || { fail "orun plan failed in the finished product"; tail -15 "$scratch/plan-after.log" >&2; }
python3 - "$scratch/plan-after.json" <<'AFTER' || fails=$((fails + 1))
import json, sys
plan = json.load(open(sys.argv[1]))
jobs = {(j["component"], j["environment"]): j for j in plan["jobs"]}
problems = []
for comp in ("supabase", "cloudflare-hyperdrive", "db-migrate", "web"):
    prod, stage = jobs.get((comp, "prod")), jobs.get((comp, "stage"))
    if not prod or not stage or stage["id"] not in (prod.get("dependsOn") or []):
        problems.append(f"{comp}@prod does not wait on {comp}@stage — the promotion gate is not back")
dev = sorted(c for (c, e) in jobs if e == "dev")
if dev != ["db", "db-tests", "web", "web-tests"]:
    problems.append(f"dev verifies {dev} on a push to main; it must verify db, db-tests, web and web-tests")
for p in problems:
    print(f"  ✕ {p}", file=sys.stderr)
if problems:
    sys.exit(1)
print("   prod waits on stage for every component; dev verifies db, db-tests, web and web-tests")
AFTER

# ── 6. a resume over the finished product ─────────────────────────────────
echo "── --resume over the finished product"
before="$(git -C "$tree" status --porcelain; git -C "$tree" rev-parse HEAD)"
orun new --blueprint "$root/repo-blueprint.yaml" --out "$tree" --resume "${sets[@]}" > "$scratch/resume.log" 2>&1 \
  || { fail "--resume did not run"; tail -10 "$scratch/resume.log" >&2; }
after="$(git -C "$tree" status --porcelain; git -C "$tree" rev-parse HEAD)"
[ "$before" = "$after" ] || { fail "--resume changed the finished product:"; git -C "$tree" status --short | head -10 >&2; }
grep -q "SITE_NAME = \"Sam's Notes & Answers\"" "$tree/apps/web/lib/site.ts" \
  || fail "--resume reverted the product's identity"
[ "$fails" -eq 0 ] && echo "   nothing placed again, nothing un-branded"

[ "$fails" -eq 0 ] || { echo "placement.test.sh: $fails failure(s)" >&2; exit 1; }
echo "placement.test.sh: ok"
