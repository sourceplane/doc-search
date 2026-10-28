// The docs index the build writes (lib/docs/index.generated.json, by
// scripts/build-docs-index.ts) and the Worker reads (lib/docs/sync.ts): every
// page under pages/ upstream's indexer would embed, split into its sections,
// with the page's checksum — the same sha256 of its source upstream stored to
// tell a changed page from an unchanged one.
export type IndexedSection = {
  slug?: string
  heading?: string
  content: string
  /** GPT-3 tokens in `content`, counted at build time (upstream's tokenizer). */
  tokenCount: number
}

export type IndexedPage = {
  /** The page's path without `pages` or `.mdx`, as upstream stored it: `/docs/openai_embeddings`. */
  path: string
  parentPath?: string
  type: 'markdown'
  source: 'guide'
  checksum: string
  /** The page's `export const meta = {…}`, if it has one (upstream's). */
  meta?: Record<string, unknown>
  sections: IndexedSection[]
}

export type DocsIndex = {
  pages: IndexedPage[]
}
