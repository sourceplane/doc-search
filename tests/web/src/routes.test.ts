import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startPostgres, type TestPostgres } from "./support/postgres";
import { fakeAi } from "./support/workers-ai";

// The three route handlers, called as OpenNext calls them, over a real
// Postgres (PGlite with pgvector, every migration applied) reached through
// lib/db's DATABASE_URL fallback, and the Worker's AI binding stood in for.
//   POST /api/embeddings    the deploy's indexing step (upstream's build-time
//                           `pnpm run embeddings`)
//   POST /api/vector-search upstream's search, streamed as plain text
//   GET  /api/health        the smoke check and the deployment record's probe
const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...args: unknown[]) => getCloudflareContext(...args),
}));

let pg: TestPostgres;
let ai: ReturnType<typeof fakeAi>;
const env: Record<string, unknown> = {};

const post = (url: string, body?: unknown) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  // The app is the socket's only client (PGlite serves one session at a
  // time): the test reads and resets the database through PGlite itself.
  pg = await startPostgres();
  process.env.DATABASE_URL = pg.url;
}, 60_000);
afterAll(async () => {
  delete process.env.DATABASE_URL;
  await pg?.stop();
});
beforeEach(async () => {
  await pg.db.exec("delete from nods_page");
  ai = fakeAi();
  for (const k of Object.keys(env)) delete env[k];
  env.AI = ai;
  getCloudflareContext.mockReset();
  getCloudflareContext.mockResolvedValue({ env });
  vi.unstubAllGlobals();
});

describe("GET /api/health", () => {
  it("reports the schema migrated, nothing indexed yet, and Workers AI answering", async () => {
    const { GET } = await import("@/app/api/health/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true, database: "reachable", schema: "migrated", pages: 0, sections: 0, answers: "workers-ai",
    });
  });

  it("is a 503 when the database cannot be reached", async () => {
    const url = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://postgres:postgres@127.0.0.1:1/none";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { GET } = await import("@/app/api/health/route");
      const res = await GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, database: "unreachable" });
    } finally {
      errors.mockRestore();
      process.env.DATABASE_URL = url;
    }
  });
});

describe("POST /api/embeddings", () => {
  it("indexes the docs the Worker was built with, then embeds nothing on the next call", async () => {
    const { POST } = await import("@/app/api/embeddings/route");
    const first = await POST(post("https://x.test/api/embeddings"));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({
      ok: true, pages: 1, embedded: ["/docs/openai_embeddings"], unchanged: [], failed: [],
    });
    ai.run.mockClear();
    const second = await POST(post("https://x.test/api/embeddings"));
    expect(await second.json()).toMatchObject({ ok: true, embedded: [], unchanged: ["/docs/openai_embeddings"] });
    expect(ai.run).not.toHaveBeenCalled();
    const { GET } = await import("@/app/api/health/route");
    expect(await (await GET()).json()).toMatchObject({ pages: 1, sections: 2 });
  });

  it("re-embeds everything with ?refresh=1", async () => {
    const { POST } = await import("@/app/api/embeddings/route");
    await POST(post("https://x.test/api/embeddings"));
    const res = await POST(post("https://x.test/api/embeddings?refresh=1"));
    expect(await res.json()).toMatchObject({ embedded: ["/docs/openai_embeddings"] });
  });

  it("is a 503 without the AI binding, embedding nothing", async () => {
    delete env.AI;
    const { POST } = await import("@/app/api/embeddings/route");
    const res = await POST(post("https://x.test/api/embeddings"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/no AI binding/) });
  });

  it("is a 500 naming the page when a page fails to embed", async () => {
    ai.run.mockRejectedValue(new Error("Workers AI is down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/embeddings/route");
    const res = await POST(post("https://x.test/api/embeddings"));
    errors.mockRestore();
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ ok: false, failed: [{ path: "/docs/openai_embeddings" }] });
  });
});

describe("POST /api/vector-search", () => {
  async function index() {
    const { POST } = await import("@/app/api/embeddings/route");
    expect((await POST(post("https://x.test/api/embeddings"))).status).toBe(200);
  }

  it("says the index is empty before the docs are indexed — a 200 the dialog shows, not a failure", async () => {
    const { POST } = await import("@/app/api/vector-search/route");
    const { EMPTY_INDEX_ANSWER } = await import("@/lib/search");
    const res = await POST(post("https://x.test/api/vector-search", { prompt: "What is pgvector?" }));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(EMPTY_INDEX_ANSWER);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it("refuses a request with no prompt, as upstream did (400)", async () => {
    const { POST } = await import("@/app/api/vector-search/route");
    const res = await POST(post("https://x.test/api/vector-search", {}));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing query in request data", data: {} });
    const noBody = await POST(new Request("https://x.test/api/vector-search", { method: "POST", body: "not json" }));
    expect(noBody.status).toBe(400);
  });

  it("embeds the question, matches the closest section, and streams an answer built on it", async () => {
    await index();
    env.MATCH_THRESHOLD = "0.05"; // the stand-in's bag of words, not BGE's space
    ai.run.mockClear();
    const { POST } = await import("@/app/api/vector-search/route");
    const res = await POST(post("https://x.test/api/vector-search", {
      prompt: "How do I store embeddings in Postgres with pgvector?",
    }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("From the docs: Storing Embeddings in Postgres");
    const [embedCall, chatCall] = ai.run.mock.calls;
    expect(embedCall![0]).toBe("@cf/baai/bge-base-en-v1.5");
    expect(chatCall![0]).toBe("@cf/meta/llama-4-scout-17b-16e-instruct");
    const prompt = (chatCall![1] as { messages: { content: string }[]; max_tokens: number; temperature: number });
    expect(prompt.max_tokens).toBe(512);
    expect(prompt.temperature).toBe(0);
    const text = prompt.messages.at(-1)!.content;
    expect(text).toContain("You are a very enthusiastic Supabase representative");
    expect(text).toContain('Question: """\nHow do I store embeddings in Postgres with pgvector?\n"""');
    expect(text.indexOf("## Storing Embeddings in Postgres")).toBeLessThan(text.indexOf("# OpenAI Embeddings"));
  });

  it("gives the model no context when nothing clears the threshold, so it says it does not know", async () => {
    await index();
    env.MATCH_THRESHOLD = "0.99";
    const { POST } = await import("@/app/api/vector-search/route");
    const res = await POST(post("https://x.test/api/vector-search", { prompt: "What is pgvector?" }));
    expect(await res.text()).toBe("Sorry, I don't know how to help with that.");
  });

  it("moderates first when the answer is OpenAI's, and refuses flagged content (400)", async () => {
    await index();
    env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", vi.fn(async () =>
      Response.json({ results: [{ flagged: true, categories: { harassment: true } }] }),
    ));
    const { POST } = await import("@/app/api/vector-search/route");
    const res = await POST(post("https://x.test/api/vector-search", { prompt: "something flagged" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Flagged content", data: { flagged: true, categories: { harassment: true } } });
  });

  it("is a 503 without the AI binding once there is something to search", async () => {
    await index();
    delete env.AI;
    const { POST } = await import("@/app/api/vector-search/route");
    const res = await POST(post("https://x.test/api/vector-search", { prompt: "What is pgvector?" }));
    expect(res.status).toBe(503);
  });
});
