/**
 * Schema generation is part of runtime compatibility and must move with
 * the published package version (INV: auth schema release lock).
 */

import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { computeAuthSchemaReleaseState } from "../scripts/verify-auth-schema-release.mjs";
import { ATHENA_AUTH_SCHEMA_GENERATION } from "../src/auth/contract/index.ts";
import { ATHENA_AUTH_LATEST_MIGRATION } from "../src/auth/schema/migrations.ts";
import { PACKAGE_VERSION } from "../src/sdk-version.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFiles = [
  "src/auth/contract/index.ts",
  "src/auth/schema/generation.ts",
  "src/auth/schema/migrations.ts",
  "src/auth/local/authorization-sql.ts",
  "src/auth/local/schema-manifest.ts",
  "src/auth/local/signing-keys-sql.ts",
];

test("auth schema release lock matches package version and canonical generation", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as { version: string };
  assert.equal(PACKAGE_VERSION, pkg.version);
  assert.equal(ATHENA_AUTH_SCHEMA_GENERATION, ATHENA_AUTH_LATEST_MIGRATION.version);

  const lock = JSON.parse(
    readFileSync(
      join(pkgRoot, "src", "auth", "schema-release.lock.json"),
      "utf8"
    )
  ) as {
    packageVersion: string;
    authSchemaGeneration: number;
    canonicalMigrationFingerprint: string;
  };
  const state = computeAuthSchemaReleaseState(pkgRoot);
  assert.deepEqual(lock, state);
  assert.equal(lock.packageVersion, pkg.version);
  assert.equal(lock.authSchemaGeneration, ATHENA_AUTH_SCHEMA_GENERATION);
  assert.match(lock.canonicalMigrationFingerprint, /^[a-f0-9]{64}$/);
});

test("verify-auth-schema-release.mjs exits 0 against the committed lock", () => {
  const result = spawnSync(
    process.execPath,
    [join(pkgRoot, "scripts", "verify-auth-schema-release.mjs")],
    {
      cwd: pkgRoot,
      encoding: "utf8",
    }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(
    result.stdout,
    new RegExp(`generation ${ATHENA_AUTH_SCHEMA_GENERATION}`)
  );
});

test("Auth schema fingerprint is invariant to source file line endings", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-auth-schema-"));
  try {
    writeFileSync(
      join(root, "package.json"),
      readFileSync(join(pkgRoot, "package.json"))
    );
    for (const relativePath of schemaFiles) {
      const destination = join(root, relativePath);
      mkdirSync(dirname(destination), { recursive: true });
      const source = readFileSync(join(pkgRoot, relativePath), "utf8").replace(
        /\r\n?/g,
        "\n"
      );
      writeFileSync(destination, source, "utf8");
    }

    const lfState = computeAuthSchemaReleaseState(root);
    for (const relativePath of schemaFiles) {
      const destination = join(root, relativePath);
      const source = readFileSync(destination, "utf8");
      writeFileSync(destination, source.replace(/\n/g, "\r\n"), "utf8");
    }

    const crlfState = computeAuthSchemaReleaseState(root);
    assert.equal(
      crlfState.canonicalMigrationFingerprint,
      lfState.canonicalMigrationFingerprint
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});
