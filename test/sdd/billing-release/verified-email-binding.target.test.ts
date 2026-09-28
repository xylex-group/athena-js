/**
 * RED: unique-email auto-bind requires verified Athena identity; no public auth directory.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { readSrc, repoRoot } from "./helpers.ts";

const nextMinimal = join(
  repoRoot,
  "packages",
  "athena-auth-ui",
  "examples",
  "next-minimal"
);

test("unique-email auto-bind stays off by default", () => {
  const planner = readSrc("billing", "import", "planner.ts");
  assert.match(planner, /allowUniqueEmailAutoBind/);
  assert.match(planner, /unique email candidate only/);
  const types = readSrc("billing", "import", "types.ts");
  assert.match(types, /allowUniqueEmailAutoBind: false/);
});

test("next-minimal does not expose a public auth-directory Data model", () => {
  assert.equal(
    existsSync(
      join(
        nextMinimal,
        "athena",
        "migrations",
        "0002_drop_next_minimal_auth_directory.sql"
      )
    ),
    true
  );
  const drop = readFileSync(
    join(
      nextMinimal,
      "athena",
      "migrations",
      "0002_drop_next_minimal_auth_directory.sql"
    ),
    "utf8"
  );
  assert.match(drop, /DROP VIEW IF EXISTS public\.next_minimal_auth_directory/);
  const generated = join(nextMinimal, "athena", "generated");
  if (existsSync(generated)) {
    const registry = readFileSync(join(generated, "registry.ts"), "utf8");
    assert.equal(registry.includes("next_minimal_auth_directory"), false);
  }
});

test("next-minimal Mollie profile is env-only", () => {
  const root = readFileSync(
    join(nextMinimal, "src", "lib", "athena", "root.ts"),
    "utf8"
  );
  assert.equal(root.includes("pfl_t2odTH2r6p"), false);
  assert.match(root, /MOLLIE_PROFILE_ID/);
});
