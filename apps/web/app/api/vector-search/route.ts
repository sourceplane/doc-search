import { codeBlock, oneLine } from 'common-tags'
import { embed, streamText } from 'ai'
import { ApplicationError, UserError } from '@/lib/errors'
import { DatabaseNotConfiguredError, getSql } from '@/lib/db'
import { AiNotConfiguredError, chatModel, embeddingModel, moderate } from '@/lib/ai/models'
import {
  contextFrom,
  EMPTY_INDEX_ANSWER,
  MATCH_COUNT,
  matchThreshold,
  MIN_CONTENT_LENGTH,
  type MatchedSection,
} from '@/lib/search'

// Upstream's pages/api/vector-search.ts, as an App Router route handler: the
// same request ({ prompt }), the same steps — moderate, embed the question,
// match page sections, build the context, stream the answer — and the same
// prompt, word for word. What changed is where each step runs: the question
// is embedded by Workers AI (lib/ai/models.ts), the sections are matched by
// SQL over Hyperdrive instead of an RPC through Supabase's Data API, and the
// answer is Workers AI's, or OpenAI's when OPENAI_API_KEY is set (then, and
// only then, moderated first, as upstream did). Upstream's `runtime = 'edge'`
// is gone: OpenNext runs every route in the Worker, and an edge-runtime route
// does not run there.
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const requestData = (await req.json().catch(() => null)) as { prompt?: unknown } | null

    if (!requestData) {
      throw new UserError('Missing request data')
    }

    const { prompt: query } = requestData

    if (!query) {
      throw new UserError('Missing query in request data')
    }

    const sanitizedQuery = String(query).trim()

    // Moderate the content to comply with OpenAI T&C — when the answer is
    // OpenAI's (moderate() returns null on Workers AI).
    const flagged = await moderate(sanitizedQuery)
    if (flagged) {
      throw new UserError('Flagged content', {
        flagged: true,
        categories: flagged,
      })
    }

    const sql = await getSql()
    try {
      const [{ sections }] = await sql<{ sections: number }[]>`
        select count(*)::int as sections from nods_page_section`
      if (sections === 0) {
        return new Response(EMPTY_INDEX_ANSWER, {
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }

      // Create embedding from query
      const { embedding } = await embed({
        model: await embeddingModel(),
        value: sanitizedQuery.replaceAll('\n', ' '),
      })

      const pageSections = await sql<MatchedSection[]>`
        select content, token_count, similarity
          from match_page_sections(${'[' + embedding.join(',') + ']'}::vector,
                                   ${await matchThreshold()}, ${MATCH_COUNT}, ${MIN_CONTENT_LENGTH})`

      const contextText = contextFrom(pageSections)

      const prompt = codeBlock`
      ${oneLine`
        You are a very enthusiastic Supabase representative who loves
        to help people! Given the following sections from the Supabase
        documentation, answer the question using only that information,
        outputted in markdown format. If you are unsure and the answer
        is not explicitly written in the documentation, say
        "Sorry, I don't know how to help with that."
      `}

      Context sections:
      ${contextText}

      Question: """
      ${sanitizedQuery}
      """

      Answer as markdown (including related code snippets if available):
    `

      const result = streamText({
        model: await chatModel(),
        prompt,
        maxOutputTokens: 512,
        temperature: 0,
      })

      return result.toTextStreamResponse()
    } finally {
      // The stream reads nothing more from the database once it has started.
      await sql.end({ timeout: 5 }).catch(() => {})
    }
  } catch (err: unknown) {
    if (err instanceof UserError) {
      return new Response(
        JSON.stringify({
          error: err.message,
          data: err.data,
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    } else if (err instanceof AiNotConfiguredError || err instanceof DatabaseNotConfiguredError) {
      // Not upstream's: a Worker without its bindings (a `next dev` with no
      // platform proxy) says so instead of answering a bare 500.
      return Response.json({ error: err.message }, { status: 503 })
    } else if (err instanceof ApplicationError) {
      // Print out application errors with their additional data
      console.error(`${err.message}: ${JSON.stringify(err.data)}`)
    } else {
      // Print out unexpected errors as is to help with debugging
      console.error(err)
    }

    // TODO: include more response info in debug environments
    return new Response(
      JSON.stringify({
        error: 'There was an error processing your request',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
}
