# cloudflare-hyperdrive — runbook

## How it runs

Pull requests plan it; a merge to `main` applies it to `stage`, `prod`.
CI plans what changed (`orun plan --changed`) and runs each lane with `orun run`;
the plan orders a component after everything it depends on.

## Rollback

Revert the commit on `main`. The next convergence applies the previous desired
state; nothing was changed out of band, so there is nothing else to undo.

## Common failures

- **Provider authentication fails**: the workspace's provider connection is
  missing or revoked. Reconnect it in the console; credentials are brokered
  from it per run.
- **"Already exists" on a first apply**: state is empty but the resource is
  not. `adopt.tf` imports it at plan time; if it still fails, the resource was renamed outside Terraform.
