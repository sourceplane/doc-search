# cloudflare-hyperdrive — architecture

A `terraform` root at `infra/terraform/cloudflare-hyperdrive/terraform`.

- **State** lives in the Orun Cloud HTTP state backend — no local state and
  no state bucket to manage.
- **Credentials are brokered per run** from the workspace's provider
  connections and resolved by name; none is stored in this repository.
- **Adoption** (`adopt.tf`): when state is empty but the resource already
  exists, plan-time import adopts it instead of failing.

## Resources

- `cloudflare_hyperdrive_config.postgres`

## Published outputs

Written as job-output secrets on each environment after an apply; deploy
lanes downstream resolve them by name.

| Secret                         | Terraform output |
| ------------------------------ | ---------------- |
| `WIRING_CLOUDFLARE_HYPERDRIVE` | `wiring`         |

## Resolved at run time (names only)

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `TF_VAR_cloudflare_account_id`
- `TF_VAR_supabase_db_password`
- `TF_VAR_supabase_project_ref`
