import { getSql } from '@/lib/db'
import { EMBEDDING_DIMENSIONS, chatProvider } from '@/lib/ai/models'

// Not upstream's: the deploy's smoke check and the bootstrap's probe read
// this. The page renders without the database, so this proves what it never
// touches until somebody searches — the HYPERDRIVE binding names a real
// config, Hyperdrive reaches the Supabase database, and db-migrate applied the
// schema: both tables, and the embedding column at the size of the model the
// app embeds with (020_workers_ai_embeddings). It reports how much of the docs
// is indexed (`pages`, `sections`) and which provider writes the answers. It
// calls no model.
export const dynamic = 'force-dynamic'

export async function GET() {
  let sql: Awaited<ReturnType<typeof getSql>> | undefined
  try {
    sql = await getSql()
    const [row] = await sql<
      { pages: string | null; sections: string | null; dimensions: number | null }[]
    >`select to_regclass('public.nods_page')::text as pages,
             to_regclass('public.nods_page_section')::text as sections,
             (select a.atttypmod from pg_attribute a
               where a.attrelid = to_regclass('public.nods_page_section')
                 and a.attname = 'embedding') as dimensions`
    const migrated = Boolean(
      row?.pages && row?.sections && Number(row?.dimensions) === EMBEDDING_DIMENSIONS
    )
    let indexed = { pages: 0, sections: 0 }
    if (migrated) {
      const [counts] = await sql<{ pages: number; sections: number }[]>`
        select (select count(*)::int from nods_page where checksum is not null) as pages,
               (select count(*)::int from nods_page_section) as sections`
      indexed = counts!
    }
    return Response.json(
      {
        ok: migrated,
        database: 'reachable',
        schema: migrated ? 'migrated' : 'missing',
        ...indexed,
        answers: await chatProvider(),
      },
      { status: migrated ? 200 : 503, headers: { 'cache-control': 'no-store' } }
    )
  } catch (error) {
    console.error('health: database check failed', error)
    return Response.json(
      { ok: false, database: 'unreachable' },
      { status: 503, headers: { 'cache-control': 'no-store' } }
    )
  } finally {
    await sql?.end({ timeout: 5 }).catch(() => {})
  }
}
