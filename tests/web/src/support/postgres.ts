import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { createServer } from "node:net";
import { manifest } from "@saas/db/manifest";

// A real Postgres for the app's own `postgres` client: PGlite (Postgres
// compiled to WASM, with pgvector) with every migration db-migrate applies,
// in the manifest's order, served over the wire protocol on a free local
// port. lib/db/index.ts reads DATABASE_URL when it has no Cloudflare context,
// so pointing DATABASE_URL here runs the app's SQL — the sync's transactions
// and advisory locks, the search function — exactly as written. One
// connection at a time (PGlite is single-session): the clients here use
// `max: 1`.
const migrationsDir = path.resolve(__dirname, "../../../../packages/db/src/migrations");

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

export type TestPostgres = { url: string; db: PGlite; stop: () => Promise<void> };

export async function startPostgres(): Promise<TestPostgres> {
  const db = await PGlite.create({ extensions: { vector } });
  for (const entry of manifest.migrations) {
    await db.exec(readFileSync(path.join(migrationsDir, entry.path), "utf8"));
  }
  const port = await freePort();
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1" });
  await server.start();
  return {
    url: `postgres://postgres:postgres@127.0.0.1:${port}/postgres`,
    db,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
