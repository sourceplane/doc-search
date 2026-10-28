import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

// tooling/wire/worker-secrets.mjs: what hands REINDEX_TOKEN to the Worker on
// a deploy, and to wrangler dev locally. Run as the deploy runs it, with a
// made-up value, and never with a Cloudflare credential.
const SCRIPT = path.resolve(__dirname, "../../../tooling/wire/worker-secrets.mjs");
const TOKEN = "offline-fixture-not-a-token";
const ARGS = ["--secret", "REINDEX_TOKEN"];

function run(args: string[], env: Record<string, string | undefined>) {
  const clean = { ...process.env };
  delete clean.CLOUDFLARE_API_TOKEN;
  delete clean.REINDEX_TOKEN;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...clean, ...env }, encoding: "utf8" });
}

describe("worker-secrets.mjs", () => {
  it("skips an unset token and succeeds: a fresh product deploys with refresh off", () => {
    const r = run([...ARGS, "--worker", "acme-docs-web-stage"], {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("not set, skipped: REINDEX_TOKEN");
    expect(r.stdout).toContain("nothing to set");
  });

  it("pushes nothing from a verify lane (no Cloudflare credential), and prints no value", () => {
    const r = run([...ARGS, "--worker", "acme-docs-web-stage"], { REINDEX_TOKEN: TOKEN });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("a verify lane");
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });

  it("writes .dev.vars for wrangler dev with the token, readable by its owner only", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-secrets-"));
    const file = path.join(dir, ".dev.vars");
    const r = run([...ARGS, "--dev-vars", file], { REINDEX_TOKEN: TOKEN });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(`REINDEX_TOKEN="${TOKEN}"\n`);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("refuses a name that is not an environment variable", () => {
    const r = run(["--secret", "reindex-token", "--worker", "acme-docs-web-stage"], {});
    expect(r.status).toBe(2);
  });
});
