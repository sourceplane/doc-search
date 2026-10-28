// The bindings wrangler.template.jsonc gives the Worker, as seen through
// `getCloudflareContext().env` from @opennextjs/cloudflare (which types `env`
// as the global `CloudflareEnv` interface for the app to augment). Regenerate
// with `wrangler types --env-interface CloudflareEnv` after changing the
// bindings.
/// <reference types="@cloudflare/workers-types" />
interface CloudflareEnv {
  HYPERDRIVE: Hyperdrive;
  AI: Ai;
  ASSETS: Fetcher;
  // Optional Worker secret (lib/ai/models.ts): upstream's OpenAI answer model.
  OPENAI_API_KEY?: string;
  // Optional Worker vars: which OpenAI chat model (default upstream's), and
  // how similar a section must be to reach the answer (lib/search.ts).
  OPENAI_MODEL?: string;
  MATCH_THRESHOLD?: string;
}
