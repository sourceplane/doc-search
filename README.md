# doc-search

[Supabase's Next.js OpenAI Doc Search Starter](https://github.com/supabase-community/nextjs-openai-doc-search) on
**Cloudflare Workers**, deployed by [Orun](https://github.com/sourceplane/orun) to stage
and prod on every merge, and then packaged as an Orun baseline.

This commit is the repository's frame: `intent.yaml` (with the placeholder
workspace `ws_CHANGE_ME`, so CI plans nothing until it is linked), the Orun
CI workflow, the shared TypeScript and ESLint configuration, and the spec
index. The work is tracked as an epic under [`specs/epics`](specs/epics/README.md).
