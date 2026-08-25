#!/usr/bin/env node
/**
 * Fixture gate without full Metro/Hermes runtime:
 * 1) package.json exports ./react-native
 * 2) dist artifacts exist
 * 3) RN dist has no forbidden Node/server-only markers (delegates to package audit)
 * 4) no prettier SSOT in this fixture
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(__dirname, "..");
const athenaRoot = join(fixtureRoot, "..", "..", "..");
const athenaPkg = JSON.parse(
  readFileSync(join(athenaRoot, "package.json"), "utf8"),
);
const fixturePkg = JSON.parse(
  readFileSync(join(fixtureRoot, "package.json"), "utf8"),
);

function fail(msg) {
  console.error(`[expo-fixture] FAIL: ${msg}`);
  process.exit(1);
}

const exp = athenaPkg.exports?.["./react-native"];
if (!exp?.import || !exp?.types) {
  fail('missing @xylex-group/athena exports["./react-native"]');
}

for (const rel of [
  "dist/react-native.js",
  "dist/react-native.cjs",
  "dist/react-native.d.ts",
]) {
  if (!existsSync(join(athenaRoot, rel))) {
    fail(`missing ${rel} — run: pnpm --dir packages/athena-js build`);
  }
}

if (fixturePkg.dependencies?.prettier || fixturePkg.devDependencies?.prettier) {
  fail("Prettier must not be format SSOT in expo fixture");
}
if (!fixturePkg.devDependencies?.["@biomejs/biome"]) {
  fail("Biome required as lint/format SSOT");
}

const rnJs = readFileSync(join(athenaRoot, "dist/react-native.js"), "utf8");
const banned = [
  /from\s+["']fs["']/,
  /from\s+["']path["']/,
  /from\s+["']server-only["']/,
  /from\s+["']pg["']/,
  /from\s+["']react-dom["']/,
];
for (const re of banned) {
  if (re.test(rnJs)) fail(`react-native dist matched banned pattern ${re}`);
}

const audit = spawnSync(
  process.execPath,
  [join(athenaRoot, "scripts", "audit-rn-bundle-safety.mjs")],
  { cwd: athenaRoot, encoding: "utf8" },
);
if (audit.status !== 0) {
  console.error(audit.stdout || "");
  console.error(audit.stderr || "");
  fail(`audit-rn-bundle-safety exited ${audit.status}`);
}

console.log("[expo-fixture] OK: resolve + dist + audit + biome SSOT");
console.log(
  "  import target: @xylex-group/athena/react-native →",
  exp.import,
);
console.log(
  "  Note: full Metro/Hermes device bundle is optional CI; this gate is the required smoke.",
);