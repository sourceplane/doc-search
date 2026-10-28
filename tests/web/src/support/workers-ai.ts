import { vi } from "vitest";

// A stand-in for the Worker's AI binding: Workers AI's `run(model, inputs)`
// for the two models lib/ai/models.ts names. The embedding is a bag of words
// hashed into 768 dimensions and L2-normalised, so cosine similarity is real
// (shared words) though the space is not a model's; the answer is streamed as
// Workers AI streams it (server-sent events) and says which context it was
// given, so a test can see what the route sent the model.
const DIMENSIONS = 768;

function fnv1a(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function embedText(text: string): number[] {
  const v = new Array<number>(DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) v[fnv1a(word) % DIMENSIONS]! += 1;
  const norm = Math.hypot(...v);
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

export function answerFor(prompt: string): string {
  const context = /Context sections:\n([\s\S]*?)\n\s*Question: """/.exec(prompt)?.[1]?.trim() ?? "";
  if (!context) return "Sorry, I don't know how to help with that.";
  const first = context.split("\n").find((l) => l.trim()) ?? "";
  return `From the docs: ${first.replace(/^#+\s*/, "").trim()}`;
}

function sse(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const piece of text.match(/\S+\s*/g) ?? []) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ response: piece })}\n\n`));
      }
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

export function fakeAi() {
  return {
    run: vi.fn(async (model: string, inputs: Record<string, unknown>) => {
      if (model === "@cf/baai/bge-base-en-v1.5") {
        const texts = (Array.isArray(inputs.text) ? inputs.text : [inputs.text]) as string[];
        return { shape: [texts.length, DIMENSIONS], data: texts.map(embedText), pooling: "mean" };
      }
      if (model === "@cf/meta/llama-4-scout-17b-16e-instruct") {
        const messages = inputs.messages as { role: string; content: string }[];
        return sse(answerFor(messages.at(-1)?.content ?? ""));
      }
      throw new Error(`no such model in the stand-in: ${model}`);
    }),
  };
}
