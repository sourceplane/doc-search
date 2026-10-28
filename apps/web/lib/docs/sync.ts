import { embedMany, type EmbeddingModel } from 'ai'
import type { Sql } from '@/lib/db'
import { EMBEDDING_INPUT_CHARS } from '@/lib/ai/models'
import type { DocsIndex, IndexedPage } from './index-types'

// Upstream's generateEmbeddings() loop (lib/generate-embeddings.ts), run by the
// deployed Worker over the index the build wrote instead of by the build over
// pages/. Page by page, in upstream's order and with upstream's rules:
//
//   - a page whose stored checksum matches is skipped (its parent link
//     updated if that changed);
//   - a changed page loses its old sections; the page row is upserted with a
//     NULL checksum, every section is embedded and inserted, and only then is
//     the checksum written;
//   - one page failing does not stop the others, and the next sync tries it
//     again.
//
// Two changes. The database is reached with SQL over Hyperdrive, not through
// Supabase's Data API with a service-role key. And each page is synced inside
// one transaction holding an advisory lock on its path: a page that fails
// part-way rolls back whole (upstream left it half-written with a NULL
// checksum, which the next run redid; here the old sections and checksum stay
// until the new ones are all in), and two syncs at once (two deploys, or the
// smoke step and a retry) cannot both embed and insert the same page — the
// second waits, then finds the checksum written and skips.
// Upstream embedded one section per OpenAI call; here a page's sections go to
// Workers AI in one call (embedMany batches them).

export type SyncResult = {
  pages: number
  embedded: string[]
  unchanged: string[]
  failed: { path: string; error: string }[]
}

type PageRow = { id: string; checksum: string | null; parent_page_id: string | null }

async function parentId(sql: Sql, parentPath: string | undefined): Promise<string | null> {
  if (!parentPath) return null
  const [row] = await sql<{ id: string }[]>`select id from nods_page where path = ${parentPath} limit 1`
  return row?.id ?? null
}

async function syncPage(
  sql: Sql,
  model: EmbeddingModel<string>,
  page: IndexedPage,
  refresh: boolean
): Promise<'embedded' | 'unchanged'> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${'nods_page:' + page.path}))`
    const [existing] = await tx<PageRow[]>`
      select id, checksum, parent_page_id from nods_page where path = ${page.path} limit 1`
    const parent = await parentId(tx as unknown as Sql, page.parentPath)

    if (!refresh && existing?.checksum === page.checksum) {
      if ((existing.parent_page_id ?? null) !== parent) {
        await tx`update nods_page set parent_page_id = ${parent} where id = ${existing.id}`
      }
      return 'unchanged'
    }

    if (existing) {
      await tx`delete from nods_page_section where page_id = ${existing.id}`
    }

    const [row] = await tx<{ id: string }[]>`
      insert into nods_page (checksum, path, type, source, meta, parent_page_id)
      values (null, ${page.path}, ${page.type}, ${page.source},
              ${page.meta ? tx.json(page.meta as Parameters<typeof tx.json>[0]) : null}, ${parent})
      on conflict (path) do update
        set checksum = null, type = excluded.type, source = excluded.source,
            meta = excluded.meta, parent_page_id = excluded.parent_page_id
      returning id`

    if (page.sections.length > 0) {
      // Upstream replaced newlines with spaces before embedding (OpenAI's
      // advice); kept. BGE reads 512 tokens at most, so the input is cut to
      // EMBEDDING_INPUT_CHARS; the stored content is the whole section.
      const { embeddings } = await embedMany({
        model,
        values: page.sections.map((s) =>
          s.content.replace(/\n/g, ' ').slice(0, EMBEDDING_INPUT_CHARS)
        ),
      })
      for (const [i, s] of page.sections.entries()) {
        await tx`
          insert into nods_page_section (page_id, slug, heading, content, token_count, embedding)
          values (${row!.id}, ${s.slug ?? null}, ${s.heading ?? null}, ${s.content},
                  ${s.tokenCount}, ${'[' + embeddings[i]!.join(',') + ']'}::vector)`
      }
    }

    await tx`update nods_page set checksum = ${page.checksum} where id = ${row!.id}`
    return 'embedded'
  })
}

export async function syncDocs(
  sql: Sql,
  model: EmbeddingModel<string>,
  index: DocsIndex,
  { refresh = false }: { refresh?: boolean } = {}
): Promise<SyncResult> {
  const result: SyncResult = { pages: index.pages.length, embedded: [], unchanged: [], failed: [] }
  for (const page of index.pages) {
    try {
      const outcome = await syncPage(sql, model, page, refresh)
      result[outcome].push(page.path)
    } catch (error) {
      // Upstream logged and moved on to the next page; so does this. The
      // transaction rolled back, so the stored checksum still differs from
      // the build's and the next sync embeds the page again.
      console.error(`[${page.path}] failed to store its sections`, error)
      result.failed.push({ path: page.path, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
