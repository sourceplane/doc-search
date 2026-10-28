# doc-search — open risks

What is not yet proven or not yet decided. The full write-up of every risk,
including the accepted and resolved ones, is
`specs/epics/doc-search/risks-and-open-questions.md`; this page lists only
what is still live, so it should be short.

| ID | Risk | State | What closes it |
|---|---|---|---|
| DQ-A | The models are verified only against a stand-in: how well bge-base-en-v1.5 retrieves the docs' sections, and what Llama 4 Scout writes from them, are unproven | OPEN | A bootstrap against a real Cloudflare account, searched on the deployed Worker |
| DQ-B | No deploy with the brokered `workers-deploy` token has uploaded a script with an `ai` binding; Cloudflare may ask for a Workers AI permission | OPEN | The first live deploy (or the permission group added to the template) |
| DQ-C | The deploy's smoke indexes the docs: a Workers AI or Hyperdrive outage at deploy time fails the smoke (and the lane), and a deploy with many changed pages makes one request do every page's embedding | OPEN | The first live deploys; split the indexing into batches if a real doc set needs it |
| DQ-D | `MATCH_THRESHOLD`'s default (0.6) is chosen for BGE base, not measured on these docs | OPEN | Measure real scores on the sample docs after the first live bootstrap |

Accepted, and worth knowing before you change them: DQ-E (`POST
/api/embeddings` takes no credential: it can only embed the docs the Worker
was built with, and an unchanged page costs one SELECT), DQ-F (two Supabase
projects per product — the organization needs room for both), DQ-G (the
e2e's Postgres stand-in creates pgvector as superuser; a real db-migrate
apply is the first time `postgres` runs that statement).
