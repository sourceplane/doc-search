import { getCloudflareContext } from '@opennextjs/cloudflare'

// How close a section must be to the question to reach the answer, as cosine
// similarity (migration 020). Upstream's 0.78 was calibrated for OpenAI's
// ada-002, whose vectors sit close together; Workers AI's BGE base spreads
// them wider, so the default is lower. It is a setting, not a constant:
// MATCH_THRESHOLD in the Worker's environment overrides it (README, "Tuning
// the search"), because how strict to be depends on the docs. Set it as a
// Worker secret: a secret survives every later deploy, where a dashboard
// variable is replaced by the next one.
export const DEFAULT_MATCH_THRESHOLD = 0.6
export const MATCH_COUNT = 10 // upstream's
export const MIN_CONTENT_LENGTH = 50 // upstream's
export const CONTEXT_TOKEN_BUDGET = 1500 // upstream's

export async function matchThreshold(): Promise<number> {
  let raw: string | undefined
  try {
    const { env } = await getCloudflareContext({ async: true })
    raw = env.MATCH_THRESHOLD
  } catch {
    raw = process.env.MATCH_THRESHOLD
  }
  const value = raw === undefined || raw === '' ? NaN : Number(raw)
  return Number.isFinite(value) && value >= -1 && value <= 1 ? value : DEFAULT_MATCH_THRESHOLD
}

// What the dialog shows when nothing has been indexed: the deploy indexes
// the docs (app/api/embeddings), so this is a fresh environment, or a `next
// dev` against an empty local database.
export const EMPTY_INDEX_ANSWER =
  'The documentation has not been indexed yet, so there is nothing to search. ' +
  'The next deploy indexes it, or POST /api/embeddings does it now.'

export type MatchedSection = { content: string; token_count: number | null; similarity: number }

/**
 * Upstream's context builder: the matched sections, most similar first, until
 * CONTEXT_TOKEN_BUDGET tokens. Upstream counted each section's tokens with
 * GPT3Tokenizer on every request; the count is stored with the section now
 * (the build counts it with the same tokenizer), so the Worker does not carry
 * the tokenizer.
 */
export function contextFrom(sections: MatchedSection[]): string {
  let tokenCount = 0
  let contextText = ''
  for (const section of sections) {
    tokenCount += section.token_count ?? 0
    if (tokenCount >= CONTEXT_TOKEN_BUDGET) break
    contextText += `${section.content.trim()}\n---\n`
  }
  return contextText
}
