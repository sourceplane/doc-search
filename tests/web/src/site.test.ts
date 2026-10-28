import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as path from "node:path";

// lib/site.ts is the product's name seam (the rename at instantiation
// rewrites its literal) and the page's source link; pages/index.tsx reads
// both, where upstream wrote the title inline and linked Supabase's
// repository.
const app = path.resolve(__dirname, "../../../apps/web");

describe("the name and the source link", () => {
  it("are one literal line each in lib/site.ts", async () => {
    const source = readFileSync(path.join(app, "lib/site.ts"), "utf8");
    const name = /^export const SITE_NAME = (".*");$/m.exec(source);
    expect(name, "SITE_NAME line").not.toBeNull();
    expect(JSON.parse(name![1]!).trim()).not.toBe("");
    const { SITE_NAME, SOURCE_URL } = await import("@/lib/site");
    expect(SITE_NAME).toBe(JSON.parse(name![1]!));
    expect(SOURCE_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+$/);
  });

  it("are what the page renders: its <title> and its GitHub link", () => {
    const page = readFileSync(path.join(app, "pages/index.tsx"), "utf8");
    expect(page).toContain("<title>{SITE_NAME}</title>");
    expect(page).toContain("<Link href={SOURCE_URL}");
    expect(page).not.toMatch(/github\.com\/supabase\/supabase/);
  });

  it("fetches no font at build time", () => {
    const page = readFileSync(path.join(app, "pages/index.tsx"), "utf8");
    expect(page).not.toMatch(/from ['"]next\/font\/(google|local)['"]/);
  });
});
