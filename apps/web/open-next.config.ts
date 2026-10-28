// OpenNext Cloudflare adapter config.
//
// The page (pages/index.tsx) has no server data, so `next build` pre-renders
// it once; the three routes under app/api are dynamic, and the search
// streams. Nothing uses `"use cache"`, `cacheTag` or
// `revalidateTag`, so the static-assets incremental cache — the pre-rendered
// shell served straight from the Worker's static assets, read only, nothing
// to provision — is the whole cache. The build populates it by a copy
// (scripts/populate-static-assets-cache.mjs says why). A template that
// revalidates swaps this for the R2 incremental cache plus a tag cache, and
// its build goes back to `opennextjs-cloudflare populateCache`.
import { defineCloudflareConfig } from "@opennextjs/cloudflare/config";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
