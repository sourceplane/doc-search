import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createWorkersAI } from "workers-ai-provider";
import { startPostgres, type TestPostgres } from "./support/postgres";
import { fakeAi } from "./support/workers-ai";
import { syncDocs } from "@/lib/docs/sync";
import type { DocsIndex } from "@/lib/docs/index-types";
import committed from "@/lib/docs/index.generated.json";

// lib/docs/sync.ts — upstream's embedding loop, run by the Worker — over a
// real Postgres with every migration applied (PGlite with pgvector, served
// to the app's own postgres client) and the real workers-ai-provider over a
// stand-in AI binding. What the deploy's POST /api/embeddings does, checked
// row by row: which pages it embeds, what it stores, what it skips, and what
// a failure leaves behind.
const index = committed as DocsIndex;
let pg: TestPostgres;
let sql: postgres.Sql;

function model(ai: ReturnType<typeof fakeAi>) {
  return createWorkersAI({ binding: ai as unknown as Ai }).textEmbedding("@cf/baai/bge-base-en-v1.5" as never);
}

beforeAll(async () => {
  pg = await startPostgres();
  sql = postgres(pg.url, { max: 1, prepare: false, fetch_types: false });
}, 60_000);
afterAll(async () => {
  await sql?.end();
  await pg?.stop();
});
beforeEach(async () => {
  await sql`delete from nods_page`;
});

describe("syncDocs (lib/docs/sync.ts)", () => {
  it("indexes the sample docs: a page row with its checksum and a section per heading, at 768 dimensions", async () => {
    const ai = fakeAi();
    const result = await syncDocs(sql, model(ai), index);
    expect(result).toEqual({ pages: 1, embedded: ["/docs/openai_embeddings"], unchanged: [], failed: [] });
    const pages = await sql`select path, checksum, type, source from nods_page`;
    expect(pages).toEqual([
      { path: "/docs/openai_embeddings", checksum: index.pages[0]!.checksum, type: "markdown", source: "guide" },
    ]);
    const sections = await sql<{ heading: string; slug: string; token_count: number; dims: number }[]>`
      select heading, slug, token_count, vector_dims(embedding) as dims from nods_page_section order by id`;
    expect(sections.map((s) => s.heading)).toEqual(["OpenAI Embeddings", "Storing Embeddings in Postgres"]);
    expect(sections.map((s) => s.slug)).toEqual(["openai-embeddings", "storing-embeddings-in-postgres"]);
    expect(sections.map((s) => s.token_count)).toEqual(index.pages[0]!.sections.map((s) => s.tokenCount));
    expect(sections.every((s) => s.dims === 768)).toBe(true);
    // One embedding call for the page's sections, batched.
    const embedCalls = ai.run.mock.calls.filter((c) => c[0] === "@cf/baai/bge-base-en-v1.5");
    expect(embedCalls).toHaveLength(1);
    expect((embedCalls[0]![1] as { text: string[] }).text).toHaveLength(2);
  });

  it("embeds nothing the second time: a page whose checksum the database holds is skipped", async () => {
    await syncDocs(sql, model(fakeAi()), index);
    const ai = fakeAi();
    const result = await syncDocs(sql, model(ai), index);
    expect(result).toEqual({ pages: 1, embedded: [], unchanged: ["/docs/openai_embeddings"], failed: [] });
    expect(ai.run).not.toHaveBeenCalled();
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from nods_page_section`;
    expect(n).toBe(2);
  });

  it("replaces a changed page's sections, and keeps the page's id", async () => {
    await syncDocs(sql, model(fakeAi()), index);
    const [before] = await sql<{ id: string }[]>`select id from nods_page`;
    const changed: DocsIndex = {
      pages: [{ ...index.pages[0]!, checksum: "changed", sections: [{ heading: "New", slug: "new", content: "# New\n\nOnly this now.", tokenCount: 6 }] }],
    };
    const result = await syncDocs(sql, model(fakeAi()), changed);
    expect(result.embedded).toEqual(["/docs/openai_embeddings"]);
    const [after] = await sql<{ id: string; checksum: string }[]>`select id, checksum from nods_page`;
    expect(after).toEqual({ id: before!.id, checksum: "changed" });
    const sections = await sql`select heading from nods_page_section`;
    expect(sections).toEqual([{ heading: "New" }]);
  });

  it("re-embeds every page with refresh (upstream's --refresh)", async () => {
    await syncDocs(sql, model(fakeAi()), index);
    const ai = fakeAi();
    const result = await syncDocs(sql, model(ai), index, { refresh: true });
    expect(result.embedded).toEqual(["/docs/openai_embeddings"]);
    expect(ai.run).toHaveBeenCalledTimes(1);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from nods_page_section`;
    expect(n).toBe(2);
  });

  it("leaves the stored page as it was when embedding fails, reports it, and retries it next time", async () => {
    await syncDocs(sql, model(fakeAi()), index);
    const broken = fakeAi();
    broken.run.mockRejectedValue(new Error("Workers AI is down"));
    const changed: DocsIndex = { pages: [{ ...index.pages[0]!, checksum: "changed" }] };
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await syncDocs(sql, model(broken), changed);
    errors.mockRestore();
    expect(result.embedded).toEqual([]);
    expect(result.failed).toEqual([{ path: "/docs/openai_embeddings", error: expect.stringMatching(/Workers AI is down/) }]);
    // The transaction rolled back: the old checksum and both old sections stay.
    const [page] = await sql<{ checksum: string }[]>`select checksum from nods_page`;
    expect(page!.checksum).toBe(index.pages[0]!.checksum);
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from nods_page_section`;
    expect(n).toBe(2);
    // The next sync sees a checksum it does not hold, and embeds the page.
    const retried = await syncDocs(sql, model(fakeAi()), changed);
    expect(retried.embedded).toEqual(["/docs/openai_embeddings"]);
  });

  it("cuts a long section's embedding input to what BGE reads, and stores the whole section", async () => {
    const long = "word ".repeat(1000).trim();
    const ai = fakeAi();
    await syncDocs(sql, model(ai), {
      pages: [{ path: "/docs/long", type: "markdown", source: "guide", checksum: "x", sections: [{ content: long, tokenCount: 1000 }] }],
    });
    const sent = (ai.run.mock.calls[0]![1] as { text: string[] }).text[0]!;
    expect(sent.length).toBe(2000);
    const [row] = await sql<{ content: string }[]>`select content from nods_page_section`;
    expect(row!.content).toBe(long);
  });
});
