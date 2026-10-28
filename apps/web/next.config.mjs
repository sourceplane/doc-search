import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true, // upstream's
  // The page's logos go through next/image; Cloudflare has no Next.js image
  // optimizer, so they are served as they are.
  images: { unoptimized: true },
  // Required by @opennextjs/cloudflare, which bundles `.next/standalone/**`
  // into the Worker; traced from the monorepo root so workspace dependencies
  // resolve from the root node_modules.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

// `next dev` reaches the Worker's bindings through wrangler's platform proxy
// (apps/web/wrangler.jsonc, committed): HYPERDRIVE on the Postgres its
// localConnectionString names, and AI — Workers AI, which has no local mode —
// on your Cloudflare account, so `wrangler login` once. Only under `next
// dev`: the proxy would open that remote session at `next build` too, and the
// build touches neither binding (nothing pre-renders against the database or
// a model), so it must not need a Cloudflare credential.
export default function config(phase) {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
