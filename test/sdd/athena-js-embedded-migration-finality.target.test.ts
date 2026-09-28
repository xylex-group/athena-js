import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

function read(rel: string): string {
  return readFileSync(join(root, "src", rel), "utf8");
}

test("INV-MIG: billing execute keeps project env until after connectionString use", () => {
  const execute = read("cli/commands/billing/execute.ts");
  assert.match(execute, /applyGeneratorProjectEnv/);
  assert.match(execute, /restoreProjectEnv: false/);
  assert.doesNotMatch(
    execute,
    /authority\.restoreEnv\(\);\s*\n\s*if \(provider\.kind/
  );
});

test("INV-MIG: Chat 0001 lists chat-runtime-v4 as a legacy checksum", () => {
  const catalog = read("migrations/embedded-chat/catalog.ts");
  assert.match(catalog, /chat-runtime-v4/);
  assert.match(catalog, /legacyChecksums/);
  assert.match(catalog, /requiredRelations/);
});

test("INV-MIG: Billing latest generation lists requiredRelations including rejections", () => {
  const catalog = read("migrations/embedded-billing/catalog.ts");
  assert.match(catalog, /requiredRelations/);
  assert.match(catalog, /billing_webhook_ingress_rejections/);
});
