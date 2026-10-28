# supabase — architecture

A `terraform` root at `infra/terraform/supabase/terraform`.

- **State** lives in the Orun Cloud HTTP state backend — no local state and
  no state bucket to manage.
- **Credentials are brokered per run** from the workspace's provider
  connections and resolved by name; none is stored in this repository.
- **Adoption** (`adopt.tf`): when state is empty but the resource already
  exists, plan-time import adopts it instead of failing.

## Resources

- `random_password.db_password`
- `supabase_project.this`

## Published outputs

Written as job-output secrets on each environment after an apply; deploy
lanes downstream resolve them by name.

| Secret                 | Terraform output    |
| ---------------------- | ------------------- |
| `SUPABASE_PROJECT_REF` | `project_ref`       |
| `SUPABASE_DB_PASSWORD` | `database_password` |
| `SUPABASE_DB_URL`      | `connection_uri`    |

## Resolved at run time (names only)

- `SUPABASE_ACCESS_TOKEN`
- `TF_VAR_supabaseOrgId`
