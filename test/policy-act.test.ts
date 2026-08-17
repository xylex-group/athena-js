import { strict as assert } from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const policySrc = join(here, "../src/policy");
const packageJsonPath = join(here, "../package.json");

test("ACT-POL-01 no PolicyClient / createPolicyClient constructor", () => {
  const files = readdirSync(policySrc).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const text = readFileSync(join(policySrc, file), "utf8");
    assert.equal(text.includes("createPolicyClient"), false, file);
    assert.equal(text.includes("class PolicyClient"), false, file);
    assert.equal(text.includes("function PolicyClient"), false, file);
  }

  const pkg = readFileSync(packageJsonPath, "utf8");
  assert.equal(pkg.includes("PolicyClient"), false);
});

test("ACT-POL-07 policy public surface has no Node importer/compiler graph", () => {
  const index = readFileSync(join(policySrc, "index.ts"), "utf8");
  const banned = [
    "postgres-rls",
    "supabase-import",
    "node:fs",
    "node:child_process",
    "pg'",
    'from "pg"',
    "server-only",
  ];
  for (const token of banned) {
    assert.equal(index.includes(token), false, `index must not reference ${token}`);
  }

  // Walk local imports from index (shallow) and ensure no importer modules.
  const files = readdirSync(policySrc).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    if (file.includes("import") && file !== "index.ts") {
      // reserved for future node-only importer — must not exist on browser path yet
      assert.fail(`unexpected import-named module in policy package: ${file}`);
    }
    const text = readFileSync(join(policySrc, file), "utf8");
    assert.equal(text.includes("CREATE POLICY"), false, file);
    assert.equal(text.includes("pg_policy"), false, file);
  }
});

test("ACT-POL-05 contracts/policy errors align with 7000 band", () => {
  const errorsPath = join(here, "../../../contracts/policy/errors.json");
  const errors = JSON.parse(readFileSync(errorsPath, "utf8")) as {
    base: number;
    band?: string;
    codes: Array<{
      code: string;
      errorNumber: number;
      status: number;
      description?: string;
    }>;
  };
  assert.equal(errors.base, 7000);
  assert.equal(errors.band ?? "7000-7999", "7000-7999");
  assert.equal(errors.codes[0]?.code, "POLICY_DENIED");
  assert.equal(errors.codes[0]?.errorNumber, 7000);
  assert.equal(errors.codes[0]?.status, 403);
  assert.ok((errors.codes[0]?.description ?? "").length > 0);
  assert.equal(errors.codes.some((c) => c.code === "POLICY_SUBJECT_REQUIRED"), true);
  assert.equal(errors.codes.length, 21);
});
