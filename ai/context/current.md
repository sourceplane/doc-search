# doc-search — where this repository stands

The entry page for anyone (or any agent) picking this repository up. It is
this repository's own state and does not ship to a product built from it; the
two pages that do are [operations.md](operations.md) and
[deployment.md](deployment.md).

## What it is

Supabase's Next.js OpenAI Doc Search Starter
(`supabase-community/nextjs-openai-doc-search`) on Cloudflare Workers +
Static Assets through `@opennextjs/cloudflare`, its index a pgvector table in
a Supabase project's Postgres reached through Hyperdrive, packaged as an Orun
baseline: `orun new --blueprint repo-blueprint.yaml` builds a new product in
its own repository and takes it to live on stage and prod in one landing
(`01-product`) — the Supabase project, then the Hyperdrive config, then the
migrations, then the Worker, whose deploy indexes the docs — and records what
went live (`02-docs`). A fresh product embeds and answers on Workers AI
through its `AI` binding, with no AI vendor key.

## Release

| | |
|---|---|
| Latest tag | `baseline-v1` (DQ2 — the baseline, on the turso-starter v8 shape at orun v2.88.0) |
| Proven live | No. Everything short of the platform is proven offline in Baseline CI, with stand-ins for Workers AI and Supabase's Management API. The real models, a deploy with the brokered token and its `AI` binding, the Terraform and db-migrate applies, the smoke's indexing against a real account and a live bootstrap are still to come (risks DQ-A, DQ-B, DQ-C) |

## Where to read

| Question | Page |
|---|---|
| What shipped, and every departure from upstream | `specs/epics/doc-search/IMPLEMENTATION-STATUS.md` |
| Why it is built this way | [decisions.md](decisions.md), then `specs/epics/doc-search/design.md` |
| What could still go wrong | [open-risks.md](open-risks.md), then `specs/epics/doc-search/risks-and-open-questions.md` |
| How to instantiate it | `BOOTSTRAP.md`, `docs/phases/` |
| What each component is | `docs/` beside each `component.yaml` — `apps/web`, `packages/db`, `infra/db-migrate`, `infra/terraform/{supabase,cloudflare-hyperdrive}`, `tests/{web,db}` (generated; `python3 tooling/catalog/gen-component-docs.py`) |

## Next

1. Bootstrap one product from `baseline-v1` against a workspace with
   Cloudflare and Supabase connected (two free project slots, DQ-F): the
   first run of the real models and of the `AI` binding under the brokered
   deploy token, the first Terraform and db-migrate applies, and the first
   indexing by a deploy's smoke (closes DQ-A, DQ-B, DQ-C).
2. Calibrate `MATCH_THRESHOLD` against real BGE scores on the sample docs
   (DQ-D).
