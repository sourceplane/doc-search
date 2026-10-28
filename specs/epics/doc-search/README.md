# doc-search — Supabase's Next.js OpenAI Doc Search on Cloudflare

**The template's app as it is — a ⌘K search dialog that answers a question
about the site's own MDX docs, streamed, from the sections closest to it by
vector similarity — on one Cloudflare Worker, the docs embedded and the
answer written by Workers AI, the vectors in a Supabase project's pgvector
behind Hyperdrive; the docs indexed by the deployed Worker, never by a build
holding a key; and the baseline that makes a copy of it somebody else's
product in one landing.**

| | |
|---|---|
| Status | ✅ Shipped (`baseline-v1`) — proven offline in Baseline CI; live bootstrap pending (risks DQ-A, DQ-B) |
| Upstream | [supabase-community/nextjs-openai-doc-search](https://github.com/supabase-community/nextjs-openai-doc-search) (Apache-2.0), Vercel's [Next.js OpenAI Doc Search Starter](https://vercel.com/templates/next.js/nextjs-openai-doc-search-starter), at `50d6bb7` |
| Reference | [rag-chatbot](https://github.com/sourceplane/rag-chatbot) — an AI SDK app on Workers AI and Supabase pgvector through Hyperdrive, the 768-dimension migration, db-migrate, the e2e's Workers AI stand-in |
| Key | `DQ` |

## Read in this order

1. [design.md](design.md) — the template, how each piece maps to Cloudflare
   and Supabase, where the docs are embedded and why there, the models and
   the search, the repository, and the alternatives rejected.
2. [implementation-plan.md](implementation-plan.md) — the milestones.
3. [risks-and-open-questions.md](risks-and-open-questions.md) — what is not
   proven, and what was accepted.
4. [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) — what shipped, and
   every departure from the upstream template.

## Milestones

| Milestone | What it lands | Task |
|---|---|---|
| DQ0 — the spec | the repository, its intent, CI, tooling and spec index; this doc set | DQ-1 |
| DQ1 — the doc search on Workers and Supabase | the template in `apps/web`, the models on Workers AI, the docs index and the Worker's indexing, the migrations, the Supabase and Hyperdrive roots, the tests | DQ-2 |
| DQ2 — a baseline | the console card, the build document, the context pack and the baseline's tests | DQ-3 |
