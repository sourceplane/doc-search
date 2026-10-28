import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import committed from "@/lib/docs/index.generated.json";
import type { DocsIndex } from "@/lib/docs/index-types";

// lib/docs/index.generated.json is what the Worker embeds (POST
// /api/embeddings): pages/**/*.mdx read and split by upstream's own MDX
// processing (lib/docs/process-mdx.ts) at build time. It is committed so the
// Worker's code typechecks and tests in a fresh checkout; these hold it to
// pages/, and to what upstream's processing makes of them.
const app = path.resolve(__dirname, "../../../apps/web");
const index = committed as DocsIndex;

describe("the docs index (scripts/build-docs-index.ts)", () => {
  it("is current: a fresh build of pages/ writes exactly the committed file", () => {
    const out = execFileSync(path.join(app, "node_modules/.bin/tsx"), ["scripts/build-docs-index.ts", "--check"], {
      cwd: app,
      encoding: "utf8",
    });
    expect(out).toMatch(/matches pages\//);
  });

  it("has upstream's sample doc, split at each heading, with upstream's checksum and paths", async () => {
    const { createHash } = await import("node:crypto");
    const source = readFileSync(path.join(app, "pages/docs/openai_embeddings.mdx"), "utf8");
    expect(index.pages.map((p) => p.path)).toEqual(["/docs/openai_embeddings"]);
    const [page] = index.pages;
    expect(page!.checksum).toBe(createHash("sha256").update(source).digest("base64"));
    expect(page!.sections.map((s) => [s.heading, s.slug])).toEqual([
      ["OpenAI Embeddings", "openai-embeddings"],
      ["Storing Embeddings in Postgres", "storing-embeddings-in-postgres"],
    ]);
    expect(page!.sections[0]!.content.startsWith("# OpenAI Embeddings\n")).toBe(true);
    expect(page!.sections.every((s) => s.tokenCount > 0)).toBe(true);
  });

  it("is not a page itself: Next.js renders nothing under pages/docs", () => {
    // pageExtensions stays Next's default (no MDX), as upstream: the .mdx
    // files are indexing sources, not routes.
    const config = readFileSync(path.join(app, "next.config.mjs"), "utf8");
    expect(config).not.toMatch(/pageExtensions/);
  });
});
