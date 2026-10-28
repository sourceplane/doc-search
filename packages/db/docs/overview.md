# db

The database migrations and their runner (built by the db-migrate component before it plans or applies)

A workspace package built by the turbo pipeline. It deploys nothing itself: its lane type-checks, lints, tests and builds it.

|              |                                                                       |
| ------------ | --------------------------------------------------------------------- |
| Type         | `turbo-package`                                                       |
| Source       | `packages/db`                                                         |
| Package      | `@saas/db`                                                            |
| Environments | `dev`: `quick-check` · `stage`: `quick-check` · `prod`: `quick-check` |

## Depends on

- (none)

## Depended on by

- **db-migrate** — Applies database migrations to stage and prod Supabase instances
