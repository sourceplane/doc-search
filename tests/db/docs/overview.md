# db-tests

The migrations' tests (the manifest and its checksums, upstream's schema verbatim, the embedding column and the search function at Workers AI's 768 dimensions and cosine similarity, and Supabase's Data API roles shut out of both tables and both functions after every migration, on an in-process Postgres with pgvector)

The test suite for **db**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/db`           |
| Package      | `@app/db-tests`      |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
