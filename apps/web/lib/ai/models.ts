import { getCloudflareContext } from '@opennextjs/cloudflare'
import { createOpenAI } from '@ai-sdk/openai'
import type { EmbeddingModel, LanguageModel } from 'ai'
import { createWorkersAI, type WorkersAI } from 'workers-ai-provider'

// Not upstream's. Upstream called OpenAI for everything with OPENAI_KEY:
// text-embedding-ada-002 for the docs and the question (1536 dimensions),
// gpt-3.5-turbo for the answer, and the moderation endpoint before both.
// Here the models are Workers AI's, through the Worker's `AI` binding
// (wrangler.jsonc): the Cloudflare account the app deploys into is the whole
// AI vendor, so a fresh deploy indexes and answers with no key.
//
//   embeddings  BGE base en v1.5, 768 dimensions — the size of the
//               `nods_page_section.embedding` column (migration
//               020_workers_ai_embeddings). Always Workers AI: the docs and the
//               question must be embedded by the same model, and a vector
//               from another model cannot be compared with these.
//   answer      Llama 4 Scout, streamed.
//
// OPENAI_API_KEY is optional. Set (a Worker secret), the ANSWER is upstream's
// own, OpenAI's chat model (OPENAI_MODEL, default upstream's gpt-3.5-turbo)
// straight from OpenAI — no gateway — and the question goes through OpenAI's
// moderation endpoint first, as upstream did, because it is OpenAI's model it
// reaches. Embeddings stay on Workers AI either way.
export const WORKERS_AI_CHAT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct'
export const WORKERS_AI_EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5'
export const EMBEDDING_DIMENSIONS = 768
export const OPENAI_DEFAULT_MODEL = 'gpt-3.5-turbo'

// Workers AI's BGE models read at most 512 tokens. A section longer than that
// is embedded from its first EMBEDDING_INPUT_CHARS characters (roughly 450
// tokens of English); the whole section is still stored and still goes to the
// answer as context. Upstream's model read 8191 tokens.
export const EMBEDDING_INPUT_CHARS = 2000

export class AiNotConfiguredError extends Error {
  constructor() {
    super('Workers AI is not available: the Worker has no AI binding (wrangler.jsonc)')
    this.name = 'AiNotConfiguredError'
  }
}

async function bindings(): Promise<Partial<CloudflareEnv>> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    return env
  } catch {
    // Not running under OpenNext (a script, a test): no bindings.
    return {}
  }
}

async function aiBinding(): Promise<Ai> {
  const env = await bindings()
  if (env.AI) return env.AI
  throw new AiNotConfiguredError()
}

async function openAiKey(): Promise<string | undefined> {
  const env = await bindings()
  return env.OPENAI_API_KEY || process.env.OPENAI_API_KEY || undefined
}

/** Which provider writes the answer — reported by /api/health. */
export async function chatProvider(): Promise<'openai' | 'workers-ai'> {
  return (await openAiKey()) ? 'openai' : 'workers-ai'
}

export async function chatModel(): Promise<LanguageModel> {
  const key = await openAiKey()
  if (key) {
    const env = await bindings()
    const openai = createOpenAI({ apiKey: key })
    return openai.chat(env.OPENAI_MODEL || process.env.OPENAI_MODEL || OPENAI_DEFAULT_MODEL)
  }
  const workersai = createWorkersAI({ binding: await aiBinding() })
  return workersai(WORKERS_AI_CHAT_MODEL as Parameters<WorkersAI['chat']>[0])
}

export async function embeddingModel(): Promise<EmbeddingModel<string>> {
  const workersai = createWorkersAI({ binding: await aiBinding() })
  return workersai.textEmbedding(
    WORKERS_AI_EMBEDDING_MODEL as Parameters<WorkersAI['textEmbedding']>[0]
  )
}

/**
 * OpenAI's moderation endpoint, upstream's first step — called only when the
 * answer is OpenAI's (its terms ask for it). Returns the flagged categories,
 * or null when the input passes or the answer is Workers AI's.
 */
export async function moderate(input: string): Promise<Record<string, boolean> | null> {
  const key = await openAiKey()
  if (!key) return null
  const response = await fetch('https://api.openai.com/v1/moderations', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ input }),
  })
  if (!response.ok) {
    throw new Error(`OpenAI moderation answered ${response.status}`)
  }
  const { results } = (await response.json()) as {
    results: { flagged: boolean; categories: Record<string, boolean> }[]
  }
  const [result] = results
  return result?.flagged ? result.categories : null
}
