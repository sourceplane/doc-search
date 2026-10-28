# Epics

Orun-style work programs. Each epic is a folder carrying `epic.yaml` (the
declaration the platform reads: slug, key prefix, milestones with exit
criteria and task keys) beside its doc set. The pull request that adds the
folder is the adoption; the merge creates the epic in the workspace.

| Epic | Cluster | Status | What it is |
|------|---------|--------|------------|
| [`doc-search/`](./doc-search/) | **DQ** | In progress (DQ0) | Supabase's Next.js OpenAI Doc Search — a ⌘K dialog answering questions about the site's own MDX docs — on Cloudflare Workers with Workers AI and Supabase pgvector through Hyperdrive, the docs indexed by the deployed Worker on every deploy, and an Orun baseline that instantiates it in one landing (DQ2) |

As-built ≠ intent: what shipped lives in each epic's `IMPLEMENTATION-STATUS.md`.
