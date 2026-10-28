#!/usr/bin/env bash
# THE LEAK GATE — what a product carries, and what stays in the factory.
#
# A product built from this baseline is somebody's doc search, not a copy of this
# repository. It gets the product: the app, the Terraform roots, the
# migrations, the tests, its CI, its tooling, its README and its two context
# pages. It does NOT get the factory: the blueprints, the bootstrap and
# rebrand tooling, the test gates, the task contracts and identity under
# `.baseline/`, this repository's own epic and task tree, or BOOTSTRAP.md —
# and no file it does get may NAME one of those paths, because in the
# product they point at nothing.
#
# This asks orun to DERIVE the placement — every file every phase would write
# — and gates that set, then reads every shipped file's source. Derivation
# runs no hooks, contacts nothing and writes nothing.
# testing/placement.test.sh gates the same rules over a tree that is actually
# placed and branded.
#
# Needs: orun + python3 (+PyYAML) + node. No network, no credential.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/.." && pwd)"

command -v orun >/dev/null || { echo "leak.test.sh needs orun on PATH" >&2; exit 1; }

scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT

echo "── deriving what every phase would place"
sets=()
while IFS=$'\t' read -r k v; do sets+=( --set "$k=$v" ); done < <(
  python3 - "$here/fixtures/acme.json" <<'PY'
import json, sys
for k, v in json.load(open(sys.argv[1])).items():
    if not k.startswith("_"):
        print(f"{k}\t{'true' if v is True else 'false' if v is False else v}")
PY
)
orun new --blueprint "$root/repo-blueprint.yaml" --status --json \
  --out "$scratch/empty" "${sets[@]}" > "$scratch/status.json"

# intent.yaml ships with this repository's `work:` block, and the bootstrap
# strips it before the first landing (work-tree.mjs). Read the intent the
# product actually gets.
cp "$root/intent.yaml" "$scratch/intent.yaml"
node "$root/tooling/bootstrap/work-tree.mjs" --strip --file "$scratch/intent.yaml" >/dev/null

python3 - "$scratch/status.json" "$root" "$scratch/intent.yaml" <<'PY'
import json, pathlib, re, sys
import yaml

status = json.load(open(sys.argv[1]))
root = pathlib.Path(sys.argv[2])
stripped_intent = pathlib.Path(sys.argv[3])
problems = []
def bad(m): problems.append(m)

# Against an empty output directory every file a phase places is "missing", so
# the union of those lists IS the product's file set.
placed = sorted({f for ph in status["phases"] for f in (ph.get("missing") or [])})
if len(placed) < 100:
    sys.exit(f"only {len(placed)} files derived — the tree is not a product")

# ── the context pack, exactly ─────────────────────────────────────────────
ALLOWED_AI = {"ai/context/deployment.md", "ai/context/operations.md"}
shipped_ai = {p for p in placed if p.startswith("ai/")}
for extra in sorted(shipped_ai - ALLOWED_AI):
    bad(f"{extra} ships to the product and is this repository's own state")
for missing in sorted(ALLOWED_AI - shipped_ai):
    bad(f"{missing} is declared a product file and would not ship")

# ── the factory never ships ───────────────────────────────────────────────
NEVER = (".baseline/", "specs/", "tasks/", "testing/", "hooks/", "docs/phases/",
         "tooling/rebrand/", "tooling/bootstrap/", ".github/workflows/baseline.yml",
         ".github/workflows/tag.yml", "BOOTSTRAP.md", "repo-blueprint.yaml",
         "blueprint.yaml", "flows/", "agents/")
for p in placed:
    for never in NEVER:
        if p == never or p.startswith(never):
            bad(f"{p} would ship — it is the factory, not the product")

# ── nothing local and nothing built ───────────────────────────────────────
# `.env.example` and `.dev.vars.example` ship (they document the keys); a
# real `.env`, `.dev.vars` or Terraform state never does.
LOCAL = re.compile(r"(^|/)(\.env(\.[^/]*\.local|\.local)?|\.dev\.vars(\.local)?|node_modules|\.next|"
                   r"\.open-next|\.wrangler|\.turbo|\.orun|\.terraform|[^/]*\.tfstate(\.backup)?|"
                   r"next-env\.d\.ts|[^/]*\.tsbuildinfo|dist)(/|$)")
for p in placed:
    if LOCAL.search(p):
        bad(f"{p} would ship — a local or built file of whoever ran the bootstrap")

# ── what a product cannot run without ─────────────────────────────────────
if "README.md" not in placed:
    bad("README.md would not ship")
MUST = (
    ".github/workflows/ci.yml", ".rebrand/values.json",
    "apps/web/component.yaml", "apps/web/lib/site.ts", "apps/web/lib/ai/models.ts",
    # COMMITTED, because the composition checks it exists before the build:
    "apps/web/wrangler.jsonc", "apps/web/wrangler.template.jsonc", "apps/web/wiring.fixture.json",
    "apps/web/app/api/health/route.ts", "apps/web/app/api/vector-search/route.ts",
    "apps/web/app/api/embeddings/route.ts",
    # The docs index the Worker embeds, and the docs it is built from: the
    # build regenerates it, but typecheck and the tests read the committed one.
    "apps/web/lib/docs/index.generated.json", "apps/web/pages/docs/openai_embeddings.mdx",
    "apps/web/scripts/build-docs-index.ts", "apps/web/LICENSE",
    "apps/web/.env.example", "apps/web/.dev.vars.example",
    "infra/terraform/supabase/component.yaml", "infra/terraform/supabase/terraform/main.tf",
    "infra/terraform/supabase/terraform/adopt.tf",
    "infra/terraform/cloudflare-hyperdrive/component.yaml",
    "infra/terraform/cloudflare-hyperdrive/terraform/main.tf",
    "infra/db-migrate/component.yaml",
    "packages/db/src/manifest.ts", "packages/db/src/migrations/010_doc_search_init/up.sql",
    "packages/db/src/migrations/020_workers_ai_embeddings/up.sql",
    "packages/db/src/migrations/030_data_api_closed/up.sql",
    "tooling/wire/live.mjs", "tooling/migrations/manifest.mjs",
    "tests/web/component.yaml", "tests/db/component.yaml",
)
for must in MUST:
    if must not in placed:
        bad(f"{must} would not ship, and a product needs it")

# ── every shipped file, read for the factory's paths ──────────────────────
# A file that ships naming `testing/`, `.baseline/` or `repo-blueprint`
# points the product's reader — or its CI — at something it does not have.
# Each placed path is mapped back to the source its module copies from.
bp = yaml.safe_load((root / "repo-blueprint.yaml").read_text())
copies = [(m["to"].rstrip("/"), m["from"].rstrip("/")) for m in bp.get("modules") or []
          if m.get("mode") == "copy"]
def source_of(dest):
    for to, frm in sorted(copies, key=lambda c: -len(c[0])):
        if dest == to:
            return root / frm
        if dest.startswith(to + "/"):
            return root / frm / dest[len(to) + 1:]
    return None
FACTORY_PATH = re.compile(r"repo-blueprint|(?<![\w./-])(?:testing|specs|tasks|\.baseline|docs/phases)/"
                          r"|BOOTSTRAP\.md|tooling/(?:rebrand|bootstrap)\b")
scanned = 0
for p in placed:
    src = stripped_intent if p == "intent.yaml" else source_of(p)
    if src is None or not src.is_file():
        continue
    try:
        text = src.read_text()
    except UnicodeDecodeError:
        continue
    scanned += 1
    for n, line in enumerate(text.splitlines(), 1):
        m = FACTORY_PATH.search(line)
        if m:
            bad(f"{p}:{n} names the factory's {m.group(0)!r}, which the product does not have: {line.strip()[:80]}")

# ── PROVENANCE, which rebrand has no rule for ─────────────────────────────
# Not a search for this baseline's name: the rebrand rewrites that, and this
# gate reads the sources before it runs. What the rebrand cannot rewrite is a
# sentence about where the product CAME FROM, or one about being a baseline.
PROVENANCE = re.compile(
    r"\bfork(ed)? (of|from)\b|\bbaseline (repo|repository|commit|tag)\b|\bthis baseline\b"
    r"|BOOTSTRAP\.md|repo-blueprint|specs/epics|\.baseline/",
    re.I,
)
SOURCES = {"README.md": ".baseline/product/README.md",
           "ai/context/operations.md": "ai/context/operations.md",
           "ai/context/deployment.md": "ai/context/deployment.md",
           "apps/web/README.md": "apps/web/README.md"}
for shipped, src in SOURCES.items():
    for n, line in enumerate((root / src).read_text(errors="replace").splitlines(), 1):
        if PROVENANCE.search(line):
            bad(f"{shipped} (from {src}:{n}) tells the product about the factory: {line.strip()[:80]}")

if problems:
    print("FAIL: the product would carry the baseline:", file=sys.stderr)
    for p in problems:
        print(f"  - {p}", file=sys.stderr)
    sys.exit(1)

print(f"   {len(placed)} files derived across every phase; {scanned} text files read")
print(f"   ai/context is exactly {len(ALLOWED_AI)} declared file(s); none of the "
      f"{len(NEVER)} factory paths ships or is named by a shipped file; nothing local or "
      f"built; no provenance prose")
PY

echo "leak.test.sh: ok"
