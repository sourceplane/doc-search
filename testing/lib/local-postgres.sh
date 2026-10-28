#!/usr/bin/env bash
# A throwaway Postgres for the e2e — the database a Supabase project would be,
# with Supabase's roles — on a random local port. Sourced.
#
#   pg_up <dir> <port> [extension…]
#                         start it in <dir> — a fresh `mktemp -d`, which it
#                         takes over — and print the URL the app and the
#                         migrations use (role `postgres`) on stdout
#   pg_down <dir>         stop it
#
# EXTENSIONS ARE CREATED UP FRONT, BY THE SUPERUSER. On Supabase, `postgres`
# runs `CREATE EXTENSION vector` itself: supautils lets it create the
# extensions Supabase calls privileged as if it were a superuser. Here there is
# no supautils and pgvector is not a trusted extension, so `postgres` — no
# superuser, by design — would be refused. Each extension named after the port
# is created by `supabase_admin` before anything else runs, in `public`, where
# an unqualified CREATE EXTENSION puts it; a migration's
# `CREATE EXTENSION IF NOT EXISTS` then finds it and skips. (What that
# statement does as `postgres` on a real project is not what this proves.)
#
# THE ROLES ARE SUPABASE'S, because what is tested here is whether the app
# still works once every table in `public` has row-level security:
#   supabase_admin  the bootstrap superuser (Supabase's own)
#   postgres        LOGIN, NOT a superuser and WITHOUT BYPASSRLS: what the
#                   app connects as through Hyperdrive and what db-migrate
#                   runs as, so it owns the tables — and ownership is the only
#                   thing that exempts it from row-level security here
#   anon, authenticated
#                   what Supabase's Data API runs requests as, with the grants
#                   Supabase gives them on `public` by default (every table the
#                   `postgres` role creates), and `postgres` a member of both
#                   so a test can `SET ROLE` to them
#
# Postgres refuses to run as root, so when the caller is root the server runs
# as the `postgres` system user (Debian's packages create one). Trust auth on
# 127.0.0.1 only: a URL's password is ignored, which is what lets the same
# `postgres://postgres:postgres@…` shape the wrangler config uses reach it.
#
# Needs: a PostgreSQL server install (initdb, pg_ctl) — /usr/lib/postgresql/*/bin
# is searched when they are not on PATH — psql, and the server's package of
# every extension named (pgvector: postgresql-<major>-pgvector).

# Every `return` here names its status: pg_down runs from an EXIT trap, and a
# bare `return` in a trap handler returns the status the script was EXITING
# with — so after a failure pg_bin "failed", pg_down stopped nothing, and the
# server outlived its deleted data directory.
pg_bin() {
  local b
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return 0; fi
  for b in /usr/lib/postgresql/*/bin; do [ -x "$b/initdb" ] && { echo "$b"; return 0; }; done
  return 1
}

pg_as() { # run a command as the user that owns the cluster
  if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi
}

pg_up() {
  local dir="$1" port="$2" bin ext
  shift 2
  bin="$(pg_bin)" || { echo "pg_up: no PostgreSQL server binaries (initdb, pg_ctl)" >&2; return 1; }
  mkdir -p "$dir"
  [ "$(id -u)" = 0 ] && chown postgres "$dir" && chmod 700 "$dir"
  pg_as "$bin/initdb" -D "$dir/data" -U supabase_admin --auth=trust -E UTF8 >"$dir/initdb.log" 2>&1 \
    || { cat "$dir/initdb.log" >&2; return 1; }
  pg_as "$bin/pg_ctl" -D "$dir/data" -l "$dir/server.log" -w -t 60 \
    -o "-p $port -c listen_addresses=127.0.0.1 -k $dir -c fsync=off" start >/dev/null \
    || { cat "$dir/server.log" >&2; return 1; }
  psql "postgres://supabase_admin@127.0.0.1:$port/postgres" -X -q -v ON_ERROR_STOP=1 >"$dir/roles.log" 2>&1 <<'SQL' \
    || { cat "$dir/roles.log" >&2; return 1; }
CREATE ROLE postgres LOGIN NOSUPERUSER NOBYPASSRLS CREATEDB CREATEROLE;
GRANT CREATE ON DATABASE postgres TO postgres;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
GRANT anon, authenticated TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
SQL
  for ext in "$@"; do
    psql "postgres://supabase_admin@127.0.0.1:$port/postgres" -X -q -v ON_ERROR_STOP=1 \
      -c "CREATE EXTENSION IF NOT EXISTS \"$ext\" SCHEMA public" >>"$dir/roles.log" 2>&1 \
      || { echo "pg_up: the server has no $ext extension to create (for pgvector: the postgresql-<major>-pgvector package)" >&2; cat "$dir/roles.log" >&2; return 1; }
  done
  echo "postgres://postgres:postgres@127.0.0.1:$port/postgres"
}

pg_down() {
  local dir="$1" bin
  bin="$(pg_bin)" || return 0
  [ -d "$dir/data" ] && pg_as "$bin/pg_ctl" -D "$dir/data" -m immediate stop >/dev/null 2>&1 || true
}
