# db-migrate — runbook

## How it runs

Pull requests plan it; a merge to `main` applies it to `stage`, `prod`.
CI plans what changed (`orun plan --changed`) and runs each lane with `orun run`;
the plan orders a component after everything it depends on.

## Rollback

Revert the commit on `main`. The next convergence applies the previous desired
state; nothing was changed out of band, so there is nothing else to undo.

## Common failures

- **An applied migration's file changed**: the run stops rather than guess.
  Restore the file and write the change as a new migration.
- **The database is unreachable**: the infrastructure lane it depends on has
  not applied for this environment; that lane runs first in a convergence.
