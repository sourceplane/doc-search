import { beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { manifest } from "@saas/db/manifest";

// Every migration db-migrate applies, in the manifest's order, on a real
// Postgres in process (PGlite: Postgres compiled to WASM, with pgvector), and
// what it leaves: the tables at Workers AI's 768 dimensions, the search
// function the app calls, and Supabase's Data API shut out of both tables and
// both functions.
const migrationsDir = path.resolve(__dirname, "../../../packages/db/src/migrations");
const sqlOf = (rel: string) => readFileSync(path.join(migrationsDir, rel), "utf8");
const fresh = () => new PGlite({ extensions: { vector } });

async function migrated(): Promise<PGlite> {
  const db = fresh();
  for (const entry of manifest.migrations) await db.exec(sqlOf(entry.path));
  return db;
}

// A 768-wide vector pointing along dimension `i` (or a mix of two).
const unit = (i: number) =>
  `array_cat(array_cat(array_fill(0, array[${i}]), array[1]), array_fill(0, array[${767 - i}]))::real[]::vector`;
const mix = (i: number, j: number, a: number, b: number) =>
  `(select array_agg(case when g = ${i} then ${a} when g = ${j} then ${b} else 0 end order by g)::real[]::vector from generate_series(0, 767) g)`;

async function withSections(db: PGlite) {
  await db.exec(`insert into nods_page (id, path, checksum, type, source) values (1, '/docs/a', 'c', 'markdown', 'guide')`);
  const long = "x".repeat(60);
  await db.exec(`
    insert into nods_page_section (page_id, slug, heading, content, token_count, embedding) values
      (1, 'near', 'Near', 'near ${long}', 11, ${unit(0)}),
      (1, 'close', 'Close', 'close ${long}', 12, ${mix(0, 1, 0.8, 0.6)}),
      (1, 'far', 'Far', 'far ${long}', 13, ${unit(1)}),
      (1, 'short', 'Short', 'too short', 2, ${unit(0)})`);
}

describe("the schema after every migration", () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await migrated();
  }, 60_000);

  it("sizes the embedding column for Workers AI's bge-base-en-v1.5 (768) and refuses another model's", async () => {
    const col = await db.query<{ type: string }>(
      `select format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = 'public.nods_page_section'::regclass and attname = 'embedding'`,
    );
    expect(col.rows[0]!.type).toBe("vector(768)");
    await db.exec(`insert into nods_page (id, path) values (99, '/x')`);
    await expect(
      db.exec(`insert into nods_page_section (page_id, content, embedding) values (99, 'x', array_fill(0.1, array[1536])::vector)`),
    ).rejects.toThrow(/expected 768 dimensions/);
    await db.exec(`delete from nods_page where id = 99`);
  });

  it("has one match_page_sections(), at 768, returning each section's token_count", async () => {
    const { rows } = await db.query<{ args: string; result: string }>(
      `select pg_get_function_identity_arguments(p.oid) as args, pg_get_function_result(p.oid) as result
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'match_page_sections'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.args).toBe("embedding vector, match_threshold double precision, match_count integer, min_content_length integer");
    expect(rows[0]!.result).toContain("token_count integer");
    expect(rows[0]!.result).toContain("similarity double precision");
  });

  it("matches by cosine similarity: nearest first, above the threshold, long enough, up to the count", async () => {
    const db = await migrated();
    await withSections(db);
    const { rows } = await db.query<{ slug: string; token_count: number; similarity: number }>(
      `select slug, token_count, round(similarity::numeric, 3)::float as similarity
         from match_page_sections(${unit(0)}, 0.5, 10, 50)`,
    );
    // 'far' is orthogonal (0, below 0.5); 'short' is identical but under 50 characters.
    expect(rows).toEqual([
      { slug: "near", token_count: 11, similarity: 1 },
      { slug: "close", token_count: 12, similarity: 0.8 },
    ]);
    const limited = await db.query(`select slug from match_page_sections(${unit(0)}, -1, 1, 50)`);
    expect(limited.rows).toEqual([{ slug: "near" }]);
  }, 60_000);

  it("keeps upstream's row-level security on both tables, with no policy, forced on neither", async () => {
    const { rows } = await db.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity, c.relforcerowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname`,
    );
    expect(rows).toEqual([
      { relname: "nods_page", relrowsecurity: true, relforcerowsecurity: false },
      { relname: "nods_page_section", relrowsecurity: true, relforcerowsecurity: false },
    ]);
    const policies = await db.query<{ n: number }>("select count(*)::int as n from pg_policies where schemaname = 'public'");
    expect(policies.rows[0]!.n).toBe(0);
  });
});

describe("Supabase's Data API roles (anon), after every migration", () => {
  it("read no row, write none, and call neither function; the owner keeps everything", async () => {
    const db = fresh();
    // Supabase's roles exist before the migrations run, with its default
    // grants — so a refusal below is the migrations' doing, not a missing grant.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;
      alter default privileges in schema public grant all on sequences to anon, authenticated;
      alter default privileges in schema public grant all on functions to anon, authenticated;`);
    for (const entry of manifest.migrations) await db.exec(sqlOf(entry.path));
    await withSections(db);
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const table of ["nods_page", "nods_page_section"]) {
          const seen = await db.query<{ n: number }>(`select count(*)::int as n from ${table}`);
          expect(seen.rows[0]!.n, `${role} ${table}`).toBe(0);
        }
        await expect(db.exec(`insert into nods_page (path) values ('/${role}')`)).rejects.toThrow(/row-level security/);
        await expect(db.query(`select * from match_page_sections(${unit(0)}, -1, 10, 0)`)).rejects.toThrow(/permission denied for function match_page_sections/);
        await expect(db.query(`select * from get_page_parents(1)`)).rejects.toThrow(/permission denied for function get_page_parents/);
      } finally {
        await db.exec("reset role");
      }
    }
    const owner = await db.query<{ n: number }>("select count(*)::int as n from match_page_sections(" + unit(0) + ", -1, 10, 0)");
    expect(owner.rows[0]!.n).toBe(4);
  }, 60_000);
});

describe("migration 020's guard", () => {
  it("refuses while a row holds another model's vector, changing nothing", async () => {
    const db = fresh();
    for (const entry of manifest.migrations.filter((m) => m.id < "020")) await db.exec(sqlOf(entry.path));
    await db.exec(`insert into nods_page (id, path) values (1, '/docs/a')`);
    await db.exec(`insert into nods_page_section (page_id, content, embedding) values (1, 'ada', array_fill(0.1, array[1536])::vector)`);
    await expect(db.exec(sqlOf("020_workers_ai_embeddings/up.sql"))).rejects.toThrow(/1 vector\(s\) from another embedding model/);
    const col = await db.query<{ type: string }>(
      `select format_type(atttypid, atttypmod) as type from pg_attribute
        where attrelid = 'public.nods_page_section'::regclass and attname = 'embedding'`,
    );
    expect(col.rows[0]!.type).toBe("vector(1536)");
  }, 60_000);
});
