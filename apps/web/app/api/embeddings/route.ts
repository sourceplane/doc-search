import index from '@/lib/docs/index.generated.json'
import type { DocsIndex } from '@/lib/docs/index-types'
import { syncDocs } from '@/lib/docs/sync'
import { DatabaseNotConfiguredError, getSql } from '@/lib/db'
import { AiNotConfiguredError, embeddingModel } from '@/lib/ai/models'

// Not upstream's route — upstream's step, moved. Upstream embedded the docs
// at `pnpm build` (`pnpm run embeddings`), with OpenAI's key and Supabase's
// service-role key in the build's environment. Here the build only writes the
// docs index (scripts/build-docs-index.ts, bundled into this Worker), and
// this route embeds it: Workers AI through the Worker's own AI binding,
// written to Postgres through its HYPERDRIVE binding. The deploy's smoke step
// POSTs here right after `wrangler deploy` (apps/web/component.yaml), so every
// deploy leaves the database holding its own docs — the brief's "embeddings in
// CI", with no credential in CI or in the build.
//
// It takes no input. What it embeds is the docs this Worker was built with,
// and only the pages whose checksum the database does not already hold, so
// calling it again — by the next deploy, a retry, or anybody — does one SELECT
// per page and embeds nothing. `?refresh=1` is upstream's `--refresh`: embed
// every page again, which only a change of embedding model calls for.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  let sql: Awaited<ReturnType<typeof getSql>> | undefined
  try {
    sql = await getSql()
    const result = await syncDocs(sql, await embeddingModel(), index as DocsIndex, { refresh })
    const ok = result.failed.length === 0
    return Response.json(
      { ok, ...result },
      { status: ok ? 200 : 500, headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof AiNotConfiguredError || error instanceof DatabaseNotConfiguredError) {
      return Response.json({ ok: false, error: error.message }, { status: 503 })
    }
    console.error('embeddings: sync failed', error)
    return Response.json(
      { ok: false, error: 'The docs could not be indexed' },
      { status: 500, headers: { 'cache-control': 'no-store' } }
    )
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {})
  }
}
