# web-tests

The app's tests (the search, indexing and health routes over a real Postgres with pgvector, the sync of the docs index and what it stores, skips and retries, the models on Workers AI and OpenAI, the committed docs index, the name seam, the committed wrangler config)

The test suite for **web**. It deploys nothing: its lane installs, builds and runs the tests.

|              |                      |
| ------------ | -------------------- |
| Type         | `turbo-package`      |
| Source       | `tests/web`          |
| Package      | `@app/web-tests`     |
| Environments | `dev`: `quick-check` |

## Depends on

- (none)

## Depended on by

- (none)
