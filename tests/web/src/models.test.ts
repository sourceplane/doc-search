import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { embedMany, streamText } from "ai";

// lib/ai/models.ts: Workers AI through the Worker's AI binding is the default
// answer model and the only embedding model; OPENAI_API_KEY, when set,
// switches the ANSWER to upstream's OpenAI model, straight from OpenAI, and
// turns on upstream's moderation step. These run the real AI SDK and the real
// workers-ai-provider against a stand-in binding — an object with Workers
// AI's `run(model, inputs, options)` answering in the shapes the catalog types
// for these two models — so what is checked is what the provider sends the
// binding and what it makes of the answer.
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

type Run = (model: string, inputs: Record<string, unknown>, options?: unknown) => Promise<unknown>;
function binding(run: Run) {
  return { run: vi.fn(run) };
}

function sse(pieces: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const p of pieces) c.enqueue(encoder.encode(`data: ${JSON.stringify({ response: p })}\n\n`));
      c.enqueue(encoder.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}

describe("lib/ai/models.ts", () => {
  const key = process.env.OPENAI_API_KEY;
  beforeEach(() => {
    vi.resetModules();
    getCloudflareContext.mockReset();
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    if (key === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = key;
    vi.unstubAllGlobals();
  });

  it("sizes the embeddings for the Workers AI model it names", async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    const models = await import("@/lib/ai/models");
    expect(models.WORKERS_AI_EMBEDDING_MODEL).toBe("@cf/baai/bge-base-en-v1.5");
    expect(models.EMBEDDING_DIMENSIONS).toBe(768);
    expect(models.WORKERS_AI_CHAT_MODEL).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    await expect(models.chatProvider()).resolves.toBe("workers-ai");
  });

  it("embeds through the AI binding: one run per batch, the vectors as Workers AI returns them", async () => {
    const vectors = [Array(768).fill(0.1), Array(768).fill(0.2)];
    const ai = binding(async () => ({ shape: [2, 768], data: vectors, pooling: "mean" }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { embeddingModel } = await import("@/lib/ai/models");
    const { embeddings } = await embedMany({ model: await embeddingModel(), values: ["a", "b"] });
    expect(embeddings).toEqual(vectors);
    expect(ai.run).toHaveBeenCalledTimes(1);
    expect(ai.run.mock.calls[0]![0]).toBe("@cf/baai/bge-base-en-v1.5");
    expect(ai.run.mock.calls[0]![1]).toEqual({ text: ["a", "b"] });
  });

  it("streams the answer through the AI binding with the chat model", async () => {
    const ai = binding(async () => sse(["Hello ", "there."]));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai } });
    const { chatModel } = await import("@/lib/ai/models");
    const result = streamText({ model: await chatModel(), prompt: "Hi" });
    expect(await result.text).toBe("Hello there.");
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [model, inputs] = ai.run.mock.calls[0]!;
    expect(model).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    expect(inputs.stream).toBe(true);
    expect(inputs.messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("answers with upstream's OpenAI model, straight from OpenAI, once OPENAI_API_KEY is set — never a gateway", async () => {
    const ai = binding(async () => {
      throw new Error("the answer must not reach Workers AI");
    });
    getCloudflareContext.mockResolvedValue({ env: { AI: ai, OPENAI_API_KEY: "sk-test" } });
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
        const chunk = { id: "c", object: "chat.completion.chunk", created: 0, model: "gpt-3.5-turbo",
          choices: [{ index: 0, delta: { content: "From OpenAI." }, finish_reason: null }] };
        return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );
    const models = await import("@/lib/ai/models");
    await expect(models.chatProvider()).resolves.toBe("openai");
    const result = streamText({ model: await models.chatModel(), prompt: "Hi" });
    expect(await result.text).toBe("From OpenAI.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]!.body.model).toBe("gpt-3.5-turbo");
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("keeps the embeddings on Workers AI when OPENAI_API_KEY is set", async () => {
    const ai = binding(async () => ({ shape: [1, 768], data: [Array(768).fill(0)] }));
    getCloudflareContext.mockResolvedValue({ env: { AI: ai, OPENAI_API_KEY: "sk-test" } });
    const { embeddingModel } = await import("@/lib/ai/models");
    await embedMany({ model: await embeddingModel(), values: ["x"] });
    expect(ai.run.mock.calls[0]![0]).toBe("@cf/baai/bge-base-en-v1.5");
  });

  it("moderates only when the answer is OpenAI's, and reports what was flagged", async () => {
    getCloudflareContext.mockResolvedValue({ env: {} });
    const fetchMock = vi.fn(async () =>
      Response.json({ results: [{ flagged: true, categories: { violence: true } }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    let models = await import("@/lib/ai/models");
    await expect(models.moderate("anything")).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();

    vi.resetModules();
    getCloudflareContext.mockResolvedValue({ env: { OPENAI_API_KEY: "sk-test" } });
    models = await import("@/lib/ai/models");
    await expect(models.moderate("anything")).resolves.toEqual({ violence: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/moderations");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
  });

  it("says plainly when there is no binding", async () => {
    getCloudflareContext.mockRejectedValue(new Error("no cloudflare context"));
    const { chatModel, embeddingModel, AiNotConfiguredError } = await import("@/lib/ai/models");
    await expect(chatModel()).rejects.toBeInstanceOf(AiNotConfiguredError);
    await expect(embeddingModel()).rejects.toThrow(/no AI binding/);
    getCloudflareContext.mockResolvedValue({ env: {} });
    await expect(chatModel()).rejects.toBeInstanceOf(AiNotConfiguredError);
  });
});
