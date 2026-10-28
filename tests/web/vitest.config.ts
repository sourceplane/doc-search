import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import * as path from "node:path";

const app = path.resolve(__dirname, "../../apps/web");

export default defineConfig({
  resolve: {
    alias: {
      "@": app,
      // The app's own copy of @opennextjs/cloudflare, so a test's vi.mock of
      // it is the module lib/ reads: pnpm gives apps/web a copy with its own
      // peers (next, wrangler), and a mock of tests/web's copy would miss it.
      "@opennextjs/cloudflare": realpathSync(path.join(app, "node_modules/@opennextjs/cloudflare")),
    },
  },
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    environment: "node",
  },
});
