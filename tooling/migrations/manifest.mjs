#!/usr/bin/env node
// Keeps packages/db/src/manifest.ts honest: every entry's `checksum` is the
// sha256 of its migration file.
//
//   node manifest.mjs check   # exit 1 and list every mismatch
//   node manifest.mjs fix     # rewrite the checksums in manifest.ts
//
// Run from packages/db (the package scripts do). An applied migration's
// checksum is immutable — `fix` is for a migration that has not been applied
// anywhere yet.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "check" && mode !== "fix") {
  console.error("usage: manifest.mjs <check|fix>");
  process.exit(2);
}
const manifestPath = resolve("src/manifest.ts");
const migrationsDir = resolve("src/migrations");
let source = readFileSync(manifestPath, "utf8");

const entryRe = /path:\s*"([^"]+)",\s*checksum:\s*"([0-9a-f]{64})"/g;
const mismatches = [];
source = source.replace(entryRe, (whole, path, recorded) => {
  const actual = createHash("sha256").update(readFileSync(resolve(migrationsDir, path))).digest("hex");
  if (actual !== recorded) mismatches.push({ path, recorded, actual });
  return mode === "fix" ? whole.replace(recorded, actual) : whole;
});

if (mismatches.length === 0) {
  console.log("manifest: every checksum matches its file");
  process.exit(0);
}
if (mode === "fix") {
  writeFileSync(manifestPath, source);
  for (const m of mismatches) console.log(`manifest: ${m.path} ${m.recorded.slice(0, 8)} → ${m.actual.slice(0, 8)}`);
  process.exit(0);
}
for (const m of mismatches) console.error(`manifest: ${m.path} recorded ${m.recorded} but the file hashes to ${m.actual}`);
process.exit(1);
