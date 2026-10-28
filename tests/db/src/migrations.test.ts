import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";
import { buildPlan, runMigrations } from "@saas/db/runner";

const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");

describe("the migration manifest (packages/db)", () => {
  it("starts with the control migration and names every file with its checksum", () => {
    expect(manifest.migrations[0]?.id).toBe("000_control_baseline");
    for (const entry of manifest.migrations) {
      const file = readFileSync(path.join(migrationsDir, entry.path));
      expect(createHash("sha256").update(file).digest("hex"), entry.id).toBe(entry.checksum);
    }
  });

  it("lists the app's migrations in order", () => {
    expect(manifest.migrations.map((m) => m.id)).toEqual([
      "000_control_baseline",
      "010_doc_search_init",
      "020_workers_ai_embeddings",
      "030_data_api_closed",
    ]);
  });

  it("plans every migration as pending offline", async () => {
    const result = await runMigrations(manifest, { mode: "plan", migrationsDir, adapter: null });
    expect(result.failed).toBeNull();
    expect(result.applied).toEqual(manifest.migrations.map((m) => m.id));
  });

  it("keeps upstream's schema verbatim and enables pgvector in it", () => {
    const sql = readFileSync(path.join(migrationsDir, "010_doc_search_init/up.sql"), "utf8");
    expect(sql.startsWith("-- Enable pgvector extension\ncreate extension if not exists vector with schema public;")).toBe(true);
    expect(sql).toContain("embedding vector(1536)");
    expect(sql).toContain('alter table "public"."nods_page_section" enable row level security;');
  });

  it("skips what the database already recorded", () => {
    const applied = new Map([[manifest.migrations[0]!.id, manifest.migrations[0]!.checksum]]);
    const plan = buildPlan(manifest, applied, migrationsDir);
    expect(plan.alreadyApplied).toEqual([manifest.migrations[0]!.id]);
    expect(plan.pending.map((m) => m.id)).toEqual(manifest.migrations.slice(1).map((m) => m.id));
    expect(plan.checksumMismatches).toEqual([]);
  });
});
