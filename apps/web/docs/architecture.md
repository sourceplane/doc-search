# web — architecture

Built by the turbo pipeline from `apps/web` and deployed with wrangler.

|                     |                                                 |
| ------------------- | ----------------------------------------------- |
| Worker config       | `apps/web/wrangler.template.jsonc`              |
| Entry               | `.open-next/worker.js`                          |
| Compatibility date  | `2026-10-01`                                    |
| Compatibility flags | `nodejs_compat`, `global_fetch_strictly_public` |

## Bindings

| Binding      | Kind                         | Source                                       |
| ------------ | ---------------------------- | -------------------------------------------- |
| `HYPERDRIVE` | Hyperdrive (pooled Postgres) | `hyperdrive_id` from `cloudflare-hyperdrive` |
| `AI`         | Workers AI                   | account-level; no resource to provision      |
| `ASSETS`     | Static assets                | `.open-next/assets`                          |

Identifiers marked _from_ a component are filled in at deploy time from
that component's published outputs for the environment being deployed.

## Wiring

Resolved at deploy time from secrets the infrastructure lanes publish (names only):

- `WIRING_CLOUDFLARE_HYPERDRIVE_PROD`
- `WIRING_CLOUDFLARE_HYPERDRIVE_STAGE`
