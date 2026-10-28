import { getCloudflareContext } from '@opennextjs/cloudflare'

// Not upstream's. `POST /api/embeddings` is open: it embeds only the pages
// whose checksum the database does not hold, so anybody calling it costs one
// SELECT per page, and the deploy's smoke calls it with no credential. Its
// `?refresh=1` — upstream's `--refresh` — is not: it embeds EVERY page again,
// billed to the owner's Workers AI, so it needs the environment's
// REINDEX_TOKEN as a bearer. The token is an optional Worker secret (an Orun
// secret the deploy hands to the Worker, README "Re-embedding every page").
// Unset, refresh is off.
export const REFRESH_DISABLED =
  'refresh=1 re-embeds every page and is off here: this environment has no REINDEX_TOKEN (README, "Re-embedding every page")'
export const REFRESH_NEEDS_BEARER = 'refresh=1 needs Authorization: Bearer <REINDEX_TOKEN>'

async function configuredToken(): Promise<string | undefined> {
  let env: Partial<CloudflareEnv> = {}
  try {
    env = (await getCloudflareContext({ async: true })).env
  } catch {
    // Not running under OpenNext (a script, a test): no bindings.
  }
  return env.REINDEX_TOKEN || process.env.REINDEX_TOKEN || undefined
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/**
 * Whether two secrets are equal, in time that depends on neither: both are
 * hashed to 32 bytes first (so their lengths are not compared), and every byte
 * of the digests is compared, whatever the first difference.
 */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)])
  let difference = 0
  for (let i = 0; i < x.length; i++) difference |= x[i] ^ y[i]
  return difference === 0
}

/** Null when the request may re-embed everything, else why it may not. */
export async function refreshRefusal(req: Request): Promise<string | null> {
  const token = await configuredToken()
  if (!token) return REFRESH_DISABLED
  const bearer = /^Bearer\s+(\S+)\s*$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!bearer) return REFRESH_NEEDS_BEARER
  return (await sameSecret(bearer, token)) ? null : REFRESH_NEEDS_BEARER
}
