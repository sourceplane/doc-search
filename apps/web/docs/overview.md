# web

Vercel's Next.js OpenAI Doc Search Starter (Next.js on Cloudflare Workers + Static Assets via @opennextjs/cloudflare, Workers AI for embeddings and answers, the docs indexed into Supabase pgvector on every deploy, per environment)

A Cloudflare Worker with Static Assets (server rendering plus static files), deployed per environment by its CI lane.

|              |                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------ |
| Type         | `cloudflare-workers-assets-turbo`                                                                                  |
| Source       | `apps/web`                                                                                                         |
| Package      | `@app/web`                                                                                                         |
| Environments | `dev`: `verify` · `stage`: `verify`, `deploy` on a push to `main` · `prod`: `verify`, `deploy` on a push to `main` |

## Depends on

- **cloudflare-hyperdrive** — Provisions Cloudflare Hyperdrive resources for stage and prod Supabase Postgres databases
- **db-migrate** — Applies database migrations to stage and prod Supabase instances

## Depended on by

- (none)
