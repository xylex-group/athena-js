/**
 * Packed tarball consumer: @xylex-group/athena from .tmp/packages/*.tgz.
 */

import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const packDir = join(pkgRoot, ".tmp", "packages");
const consumer = join(pkgRoot, "test", "fixtures", "package-consumer");
const nextEmbedded = join(pkgRoot, "test", "fixtures", "next-embedded");
const nextMinimalGolden = join(
  pkgRoot,
  "test",
  "fixtures",
  "next-minimal-golden"
);
const sourcePkg = JSON.parse(
  readFileSync(join(pkgRoot, "package.json"), "utf8")
) as { name?: string; version?: string };

test("package-install: packed tarball is installed into package-consumer, next-embedded, and next-minimal-golden", () => {
  assert.equal(existsSync(packDir), true, ".tmp/packages must exist");
  const expectedTarball = `${String(sourcePkg.name ?? "")
    .replace(/^@/, "")
    .replace(/\//g, "-")}-${sourcePkg.version}.tgz`;
  assert.equal(
    existsSync(join(packDir, expectedTarball)),
    true,
    `pnpm pack must write ${expectedTarball} (not a stale unversioned .tgz)`
  );

  for (const fixture of [consumer, nextEmbedded, nextMinimalGolden]) {
    const resolved = join(fixture, "node_modules", "@xylex-group", "athena");
    assert.equal(
      existsSync(resolved),
      true,
      `${fixture} must install @xylex-group/athena`
    );
    const pkg = JSON.parse(
      readFileSync(join(resolved, "package.json"), "utf8")
    ) as { name?: string; version?: string };
    assert.equal(pkg.name, "@xylex-group/athena");
    assert.equal(
      pkg.version,
      sourcePkg.version,
      `${fixture} must install package version ${sourcePkg.version}, got ${pkg.version}`
    );
    const real = statSync(resolved);
    assert.ok(real.isDirectory());
  }

  const authUi = join(
    nextMinimalGolden,
    "node_modules",
    "@xylex-group",
    "athena-auth-ui"
  );
  if (existsSync(authUi)) {
    const uiPkg = JSON.parse(
      readFileSync(join(authUi, "package.json"), "utf8")
    ) as {
      name?: string;
    };
    assert.equal(uiPkg.name, "@xylex-group/athena-auth-ui");
  }

  const require = createRequire(join(consumer, "consume.mjs"));
  const packed = require.resolve("@xylex-group/athena");
  assert.match(
    packed.replaceAll("\\", "/"),
    /node_modules\/@xylex-group\/athena/
  );
  assert.doesNotMatch(
    packed.replaceAll("\\", "/"),
    /packages\/athena-js\/src\//
  );
});

const PACKED_CLI_GATES: readonly (readonly string[])[] = [
  [],
  ["--help"],
  ["-v"],
  ["migrate", "--help"],
  ["migrate", "auth", "sync", "--help"],
];

test("package-install: packed athena-js CLI gates run without server-only", () => {
  const bin = join(
    consumer,
    "node_modules",
    "@xylex-group",
    "athena",
    "bin",
    "athena-js.js"
  );
  assert.equal(
    existsSync(bin),
    true,
    "packed package must publish bin/athena-js.js"
  );
  for (const args of PACKED_CLI_GATES) {
    const result = spawnSync(process.execPath, [bin, ...args], {
      cwd: consumer,
      encoding: "utf8",
      env: process.env,
    });
    const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    assert.equal(
      result.status,
      0,
      `athena-js ${args.join(" ") || "(no args)"} exited ${result.status}\n${combined}`
    );
    assert.doesNotMatch(
      combined,
      /cannot be imported from a Client Component/,
      `athena-js ${args.join(" ") || "(no args)"}`
    );
  }
});
