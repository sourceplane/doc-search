#!/usr/bin/env node
// Worker SECRETS from the job's environment (zero-dependency).
//
// Some values a build is given must reach the Worker at request time and never
// a bundle: REINDEX_TOKEN, the bearer `POST /api/embeddings?refresh=1` needs.
// The deploy lane has it in its environment (an Orun secret the component's
// `optionalSecretEnv` resolves), and this hands the named variables that are
// set to `wrangler secret bulk` as JSON over stdin, so no value is ever on a
// command line or in a log.
//
//   node worker-secrets.mjs --worker <worker-name> [--config wrangler.jsonc] \
//     --secret REINDEX_TOKEN [--secret …]
//
//   --dev-vars <file>   write the same secrets as KEY=value lines instead
//                       (wrangler dev reads .dev.vars as the Worker's secrets)
//
// The secrets are OPTIONAL, like the Orun secrets they come from: a variable
// that is not set is skipped, named, and the Worker without it keeps refresh
// off (apps/web/lib/reindex.ts). Only a job that can
// deploy holds a Cloudflare credential (the composition's deploy profile
// binds CLOUDFLARE_API_TOKEN; its verify profiles bind nothing), so without
// one this says so and exits 0: a verify lane builds exactly what the deploy
// lane does and pushes nothing.
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function args(name) {
  const out = [];
  process.argv.forEach((a, i) => {
    if (a === `--${name}` && process.argv[i + 1] !== undefined) out.push(process.argv[i + 1]);
  });
  return out;
}

const worker = arg("worker");
const config = arg("config");
const devVars = arg("dev-vars");
const names = args("secret");
if (names.length === 0 || (!worker && !devVars)) {
  console.error(
    "usage: worker-secrets.mjs --secret NAME [--secret …] (--worker <name> [--config <file>] | --dev-vars <file>)",
  );
  process.exit(2);
}
for (const name of names) {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
    console.error(`worker-secrets: --secret ${name} is not an environment variable name`);
    process.exit(2);
  }
}

const secrets = {};
const unset = [];
for (const name of names) {
  const value = process.env[name];
  if (typeof value === "string" && value.length > 0) secrets[name] = value;
  else unset.push(name);
}
if (unset.length > 0) console.log(`worker-secrets: not set, skipped: ${unset.join(", ")}`);
const set = Object.keys(secrets);
if (set.length === 0) {
  console.log("worker-secrets: nothing to set");
  process.exit(0);
}
const list = set.join(", ");

if (devVars) {
  // KEY=value, one per line, double-quoted (dotenv's syntax, which wrangler
  // reads): a JSON string is a valid dotenv double-quoted value.
  const body = Object.entries(secrets)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join("\n");
  fs.writeFileSync(devVars, `${body}\n`, { mode: 0o600 });
  console.log(`worker-secrets: wrote ${list} to ${devVars}`);
  process.exit(0);
}

if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.log(`worker-secrets: no Cloudflare credential in this job (a verify lane) — ${list} reach ${worker} from the deploy lane`);
  process.exit(0);
}

const result = spawnSync(
  "pnpm",
  ["exec", "wrangler", "secret", "bulk", "--name", worker, ...(config ? ["--config", config] : [])],
  { input: JSON.stringify(secrets), stdio: ["pipe", "inherit", "inherit"] },
);
if (result.status !== 0) {
  console.error(`worker-secrets: wrangler secret bulk failed for ${worker}`);
  process.exit(result.status ?? 1);
}
console.log(`worker-secrets: ${list} set on ${worker}`);
