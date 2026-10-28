import postgres from 'postgres'
import { getCloudflareContext } from '@opennextjs/cloudflare'

// Not upstream's. Upstream reached the database through Supabase's Data API
// with the project's service-role key (`createClient(SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY)`), both from Vercel's environment. Here the
// Worker reaches the Supabase project's Postgres directly, through the
// HYPERDRIVE binding (wrangler.jsonc): no service-role key exists anywhere,
// and the Data API is shut out of every table (row-level security, migration
// 010, kept from upstream). A `postgres` socket opened in one request cannot
// be used by another on Workers, so every caller builds its own client:
//
//   const sql = await getSql()
//
// Without a Cloudflare context — a script, a test — DATABASE_URL is the
// connection string.
async function connectionString(): Promise<string> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    if (env.HYPERDRIVE?.connectionString) return env.HYPERDRIVE.connectionString
  } catch {
    // Not running under OpenNext: fall through to DATABASE_URL.
  }
  if (!process.env.DATABASE_URL) {
    throw new DatabaseNotConfiguredError()
  }
  return process.env.DATABASE_URL
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super('No database: the Worker has no HYPERDRIVE binding and DATABASE_URL is not set')
    this.name = 'DatabaseNotConfiguredError'
  }
}

export type Sql = postgres.Sql

export async function getSql(): Promise<Sql> {
  // Hyperdrive pools on its side; a Worker request holds few connections,
  // skips the pg_types round trip and sends plain (unprepared) statements.
  return postgres(await connectionString(), {
    max: 5,
    fetch_types: false,
    prepare: false,
  })
}
