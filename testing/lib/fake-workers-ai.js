// A stand-in for Workers AI, for `wrangler dev` with no Cloudflare account.
//
// Workers AI has no local mode: the AI binding always calls the account, and
// the e2e has none. So the e2e binds `AI` to THIS Worker instead — a service
// binding to its default entrypoint, whose `run(model, inputs, options)` is
// reached over RPC exactly as the real binding's is — and the app's own code
// (lib/ai/models.ts, the real workers-ai-provider, the real AI SDK) cannot
// tell the difference in shape. What it answers is deterministic, not
// intelligent, and that is the point: the e2e asserts the app's path end to
// end, so every answer must be predictable.
//
//   @cf/baai/bge-base-en-v1.5      { shape: [n, 768], data, pooling } — a
//       bag-of-words embedding: each lowercase word hashed (FNV-1a) into one
//       of 768 dimensions, the vector L2-normalised. Two texts' cosine
//       similarity is their shared words over the geometric mean of their
//       lengths, so a question about pgvector is closer to the section that
//       talks about pgvector than to the one that does not, and a question
//       sharing no word with the docs is orthogonal to all of them —
//       retrieval by similarity is real, the space is not a model's.
//   @cf/meta/llama-4-scout-17b-16e-instruct
//       STREAMED, as the app asks for it (stream: true): server-sent events
//       in Workers AI's catalog shape, `data: {"response": "<piece>"}` …
//       `data: {"response": "", "usage": {…}}`, `data: [DONE]`. The answer is
//       read off the prompt the route sends (upstream's): when its "Context
//       sections:" hold anything, "From the docs: <the first section's first
//       line>", else upstream's "Sorry, I don't know how to help with that."
//       A whole (unstreamed) request is refused, so a change to that is
//       caught.
//
// Every call is logged as one `fake-workers-ai {…}` line, which the e2e reads
// back from wrangler's output.
import { WorkerEntrypoint } from "cloudflare:workers";

const CHAT = "@cf/meta/llama-4-scout-17b-16e-instruct";
const EMBEDDING = "@cf/baai/bge-base-en-v1.5";
const DIMENSIONS = 768;

function fnv1a(word) {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function embed(text) {
  const v = new Array(DIMENSIONS).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    v[fnv1a(word) % DIMENSIONS] += 1;
  }
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1; // no words: a fixed unit vector, never the zero vector cosine cannot measure
    return v;
  }
  return v.map((x) => x / norm);
}

const UNSURE = "Sorry, I don't know how to help with that.";

function answer(prompt) {
  const context = /Context sections:\n([\s\S]*?)\n\s*Question: """/.exec(prompt)?.[1]?.trim() ?? "";
  if (!context) return UNSURE;
  const firstLine = context.split("\n").find((l) => l.trim()) ?? "";
  return `From the docs: ${firstLine.replace(/^#+\s*/, "").trim()}`;
}

function sse(text) {
  const encoder = new TextEncoder();
  const pieces = text.match(/\S+\s*/g) ?? [];
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: piece })}\n\n`));
      }
      const usage = { prompt_tokens: 1, completion_tokens: pieces.length, total_tokens: pieces.length + 1 };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: "", usage })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export default class FakeWorkersAi extends WorkerEntrypoint {
  async run(model, inputs, _options) {
    if (model === EMBEDDING) {
      const texts = Array.isArray(inputs.text) ? inputs.text : [inputs.text];
      console.log(`fake-workers-ai ${JSON.stringify({ model, texts: texts.map((t) => String(t).slice(0, 60)) })}`);
      return { shape: [texts.length, DIMENSIONS], data: texts.map(embed), pooling: "mean" };
    }
    if (model === CHAT) {
      if (!inputs?.stream) {
        console.log(`fake-workers-ai ${JSON.stringify({ model, refused: "whole response" })}`);
        throw new Error("fake Workers AI streams the answer, and the app asked for a whole response");
      }
      const prompt = (inputs.messages ?? []).filter((m) => m.role === "user").at(-1)?.content ?? "";
      const text = answer(typeof prompt === "string" ? prompt : JSON.stringify(prompt));
      console.log(`fake-workers-ai ${JSON.stringify({ model, stream: true, answer: text })}`);
      return sse(text);
    }
    console.log(`fake-workers-ai ${JSON.stringify({ model, refused: "unknown model" })}`);
    throw new Error(`fake Workers AI does not serve ${model}`);
  }

  async fetch() {
    return new Response("a stand-in for Workers AI; bind it as AI and call run()", { status: 404 });
  }
}
