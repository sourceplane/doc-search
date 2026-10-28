# 02-docs — the deployment, recorded

**Places** nothing. Its work is hooks: it records what `01-product` built,
from probed facts rather than from what the blueprint intended, and it puts
back the two things `01-product` deferred for the bootstrap's sake.

**Requires** `01-product` placed. (A hook-only phase derives as `unknown`, so
no phase may require this one.)

## What runs

| hook | what it does |
|---|---|
| `promotion` | restores `environments.prod.promotion` — from now on prod deploys only after stage |
| `dev-lanes` | restores dev's activation on pushes to main |
| `render` | `hooks/render-deployment-docs.sh`: probes `/` and `/api/health` on both environments, reads how much of the docs is indexed and which model answers from `/api/health`, and regenerates `ai/context/deployment.md` — the identity, the probed URLs, the secrets the product uses by name and where each lives — and the README's live-deployment section. It asks the platform nothing: what the workspace holds right now is on the console's Secrets and Integrations pages, which the record points to |
| `task` | finds the phase's task and yields its key |
| `land` | one PR, its commit checked in the box (`checks: local`) and merged. It touches no component, so it deploys nothing — and there is nothing after it to wait for: the render's probes are the phase's check |

## Re-running it

Idempotent, and the way to refresh the record after a redeploy, a custom
domain, or adding OpenAI for the answers: every generated section is re-rendered from
scratch.

```bash
orun new --blueprint repo-blueprint.yaml --out <product-checkout> \
  --run-hooks --phase 02-docs --values <values.yaml>
```

## If a bootstrap stops before this phase

The promotion gate and dev's push activation stay deferred: `intent.yaml`
carries a `# @promotion-deferred:…` and a `# @dev-lanes-deferred:…` marker.
Running this phase restores both, or by hand from the baseline checkout:

```bash
node tooling/bootstrap/promotion.mjs --restore --file <product>/intent.yaml
node tooling/bootstrap/dev-lanes.mjs --restore --file <product>/intent.yaml
```
