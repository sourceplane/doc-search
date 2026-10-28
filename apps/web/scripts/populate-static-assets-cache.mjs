// The build's last step: what `opennextjs-cloudflare populateCache local`
// does for the static-assets incremental cache (open-next.config.ts) — copy
// the pre-rendered pages OpenNext wrote to .open-next/cache into the Worker's
// static assets, under the directory that cache reads (OpenNext's own
// CACHE_DIR, imported so the two cannot drift).
//
// Not that command itself, because before it copies anything it opens
// wrangler's platform proxy over wrangler.jsonc, only to read string vars,
// and the AI binding — Workers AI has no local simulator — makes the proxy
// open a session to a Cloudflare account. A build must need no credential.
// If open-next.config.ts moves to another incremental cache (R2, KV), go back
// to `opennextjs-cloudflare populateCache`: those caches are populated
// through the platform, not by a copy.
import { cpSync, existsSync } from "node:fs";
import { CACHE_DIR } from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

const from = ".open-next/cache";
const to = `.open-next/assets/${CACHE_DIR}`;
if (!existsSync(from)) {
  console.error(`populate: no ${from} — run \`opennextjs-cloudflare build\` first`);
  process.exit(1);
}
cpSync(from, to, { recursive: true });
console.log(`populate: the static-assets incremental cache, ${from} → ${to}`);
