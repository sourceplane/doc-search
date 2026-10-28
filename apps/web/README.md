# apps/web — the app

A documentation search from Supabase's
[Next.js OpenAI Doc Search Starter](https://github.com/supabase-community/nextjs-openai-doc-search)
(Apache-2.0, see `LICENSE`), running on Cloudflare Workers + Static Assets.
Vercel lists it at https://vercel.com/templates/next.js/nextjs-openai-doc-search-starter.

- The page (`/`, `pages/index.tsx`): upstream's, a ⌘K search dialog
  (`components/SearchDialog.tsx`) that streams an answer to a question about
  the docs. The title reads `SITE_NAME` (`lib/site.ts`).
- The docs: `pages/docs/**/*.mdx`. They are not pages (Next.js renders no
  MDX here, as upstream): they are what the search answers from.
- The search (`POST /api/vector-search`, `app/api/vector-search/route.ts`):
  upstream's steps — moderate, embed the question, match page sections, build
  a 1500-token context, stream the answer — with upstream's prompt.
- The indexing (`POST /api/embeddings`, `app/api/embeddings/route.ts`):
  upstream's build-time `pnpm run embeddings`, moved into the Worker. The
  build splits the docs into sections (`scripts/build-docs-index.ts` →
  `lib/docs/index.generated.json`, with upstream's MDX processing in
  `lib/docs/process-mdx.ts`); the deploy's smoke step POSTs here, and the
  Worker embeds every page whose checksum the database does not hold
  (`lib/docs/sync.ts`).
- `/api/health`: 200 only when the database is reachable through Hyperdrive
  and migrated; it says how much of the docs is indexed and calls no model.

The models are Workers AI's through the Worker's `AI` binding
(`lib/ai/models.ts`): `@cf/baai/bge-base-en-v1.5` for the embeddings (768
dimensions, the column's size) and `@cf/meta/llama-4-scout-17b-16e-instruct`
for the answers. `OPENAI_API_KEY` (a Worker secret) switches the answers to
OpenAI's model, straight from OpenAI, with upstream's moderation step first;
the embeddings stay on Workers AI.

The database is a Supabase project's Postgres with pgvector, reached through
the `HYPERDRIVE` binding (`lib/db/index.ts`); its schema is
`packages/db`'s migrations, which `infra/db-migrate` applies before every
deploy.

```bash
pnpm --filter @app/web docs:index   # re-split pages/docs into lib/docs/index.generated.json
pnpm --filter @app/web build        # docs index + next build + opennextjs-cloudflare build
pnpm --filter @app/web preview      # wrangler dev over the built Worker
```
