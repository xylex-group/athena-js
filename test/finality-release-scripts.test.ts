/**
 * Athena 5 Finality — P14 release contract (INV-14 / CI-009).
 * Seam: packages/athena-js/package.json scripts.
 */
import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("P14: check:release exists and prepublishOnly is not weaker", async () => {
  const raw = await readFile(
    new URL("../package.json", import.meta.url),
    "utf8"
  );
  const pkg = JSON.parse(raw) as { scripts: Record<string, string> };
  const release = pkg.scripts["check:release"];
  assert.equal(typeof release, "string");
  assert.match(release, /typecheck/);
  assert.match(release, /test/);
  assert.match(release, /build/);
  assert.match(release, /check:publint/);
  assert.match(release, /check:attw/);
  assert.match(release, /check:tarball/);
  assert.match(release, /docs:check/);
  assert.match(pkg.scripts.prepublishOnly, /release:verify/);
  assert.notEqual(pkg.scripts.prepublishOnly, "pnpm check:release");
  assert.match(
    pkg.scripts["release:verify"] ?? "",
    /verify-auth-schema-release/
  );
  const authSchemaVerifier = await readFile(
    new URL("../scripts/verify-auth-schema-release.mjs", import.meta.url),
    "utf8"
  );
  assert.match(authSchemaVerifier, /verify-auth-migration-history\.mjs/);
  assert.match(authSchemaVerifier, /verifyAuthMigrationHistory\(\)/);
  assert.match(
    pkg.scripts["release:verify"] ?? "",
    /test:finality\s*&&\s*(?:pnpm\s+)?test:tarball\s*&&\s*(?:pnpm\s+)?test:examples/
  );
  assert.match(pkg.scripts["release:verify"] ?? "", /check:attw/);
  assert.equal(typeof pkg.scripts["check:attw"], "string");
  assert.equal(typeof pkg.scripts["check:publint"], "string");
  assert.equal(typeof pkg.scripts["check:tarball"], "string");
  assert.equal(typeof pkg.scripts["docs:check"], "string");
  assert.equal(typeof pkg.scripts["test:parity:live"], "string");
  assert.equal(typeof pkg.scripts["test:embedded-next"], "string");
  assert.match(
    pkg.scripts["test:parity:live"],
    /parity-live|ATHENA_AUTH_URL|ATHENA_PARITY_REQUIRE_RUST/
  );
});

test("P14: run-finality selects versioned pack tarball, not lexicographic last .tgz", async () => {
  const source = await readFile(
    new URL("../scripts/run-finality.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /function expectedPackTarballName/);
  assert.match(source, /function clearPackedTarballs/);
  assert.match(source, /\$\{bare\}-\$\{pkg\.version\}\.tgz/);
  assert.doesNotMatch(source, /tgz\[tgz\.length\s*-\s*1\]/);
  assert.match(source, /clearPackedTarballs\(\)/);
});

test("P14: publish refreshes stale finality before validating the release report", async () => {
  const source = await readFile(
    new URL("../scripts/publish.js", import.meta.url),
    "utf8"
  );
  assert.match(source, /function finalityReportNeedsRefresh/);
  assert.match(source, /function refreshFinalityReportIfStale/);
  assert.match(source, /scripts\/run-finality\.mjs/);
  assert.match(
    source,
    /refreshFinalityReportIfStale\(\);\s*requireFinalityReport\(\)/
  );
});

test("P14: finality refreshes the Auth schema release lock before tests", async () => {
  const source = await readFile(
    new URL("../scripts/run-finality.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /verify-auth-schema-release\.mjs/);
  assert.match(source, /"--write"/);
});

test("P14: finality isolates inherited database URLs from the unit suite", async () => {
  const source = await readFile(
    new URL("../scripts/run-finality.mjs", import.meta.url),
    "utf8"
  );
  assert.match(
    source,
    /run\("pnpm",\s*\["test"\],\s*\{\s*env:\s*\{[\s\S]*DATABASE_URL:\s*""/
  );
});

test("P14: config boundary probes allow Windows full-suite load", async () => {
  const source = await readFile(
    new URL(
      "./sdd/athena-js-cli-config-runtime-boundary.target.test.ts",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(source, /CHILD_PROBE_TIMEOUT_MS\s*=\s*180_000/);
  assert.match(source, /timeout:\s*CHILD_PROBE_TIMEOUT_MS/);
});

test("P14: packed-consumer install allowlists esbuild under pnpm 11 strictDepBuilds", async () => {
  const source = await readFile(
    new URL("../scripts/run-finality.mjs", import.meta.url),
    "utf8"
  );
  assert.match(source, /FIXTURE_PNPM_WORKSPACE/);
  assert.match(source, /allowBuilds:\s*\n\s*esbuild: true/);
  assert.doesNotMatch(source, /installPackedConsumer[\s\S]*--ignore-workspace/);
});
