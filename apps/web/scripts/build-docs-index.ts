// The build's first step (package.json `build`, `docs:index`): what upstream's
// `pnpm run embeddings` read, written to lib/docs/index.generated.json for the
// Worker to embed. Upstream walked pages/**/*.mdx at build time AND embedded
// each section with OpenAI and upserted it through Supabase's Data API right
// there, with OPENAI_KEY and SUPABASE_SERVICE_ROLE_KEY in the build's
// environment. Here the build only reads and splits — no network, no
// credential — and the deployed Worker does the embedding through its own AI
// binding and writes through its HYPERDRIVE binding (app/api/embeddings, which
// the deploy's smoke step calls; lib/docs/sync.ts).
//
//   tsx scripts/build-docs-index.ts          # write the index
//   tsx scripts/build-docs-index.ts --check  # exit 1 if the committed index is stale
//
// The index is committed so the Worker's code typechecks and tests in a fresh
// checkout; tests/web runs the --check, so a doc changed without its index
// fails there, and `build` rewrites it anyway.
import { readFile, writeFile } from 'fs/promises'
import GPT3Tokenizer from 'gpt3-tokenizer'
import { ignoredFiles, MarkdownEmbeddingSource, walk } from '../lib/docs/process-mdx'
import type { DocsIndex, IndexedPage } from '../lib/docs/index-types'

const OUT = 'lib/docs/index.generated.json'

async function build(): Promise<DocsIndex> {
  const tokenizer = new GPT3Tokenizer({ type: 'gpt3' })
  const sources = (await walk('pages'))
    .filter(({ path }) => /\.mdx?$/.test(path))
    .filter(({ path }) => !ignoredFiles.includes(path))
    .map((entry) => new MarkdownEmbeddingSource('guide', entry.path))

  const pages: IndexedPage[] = []
  for (const source of sources) {
    const { checksum, meta, sections } = await source.load()
    pages.push({
      path: source.path,
      ...(source.parentPath ? { parentPath: source.parentPath } : {}),
      type: source.type,
      source: 'guide',
      checksum,
      ...(meta ? { meta } : {}),
      sections: sections.map((s) => ({
        ...(s.slug ? { slug: s.slug } : {}),
        ...(s.heading ? { heading: s.heading } : {}),
        content: s.content,
        tokenCount: tokenizer.encode(s.content).text.length,
      })),
    })
  }
  return { pages }
}

async function main() {
  const index = await build()
  const text = JSON.stringify(index, null, 2) + '\n'
  if (process.argv.includes('--check')) {
    const committed = await readFile(OUT, 'utf8').catch(() => '')
    if (committed !== text) {
      console.error(`${OUT} is stale: run \`pnpm --filter @app/web docs:index\` and commit it`)
      process.exit(1)
    }
    console.log(`${OUT}: matches pages/ (${index.pages.length} page(s))`)
    return
  }
  await writeFile(OUT, text)
  const sections = index.pages.reduce((n, p) => n + p.sections.length, 0)
  console.log(`${OUT}: ${index.pages.length} page(s), ${sections} section(s)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
