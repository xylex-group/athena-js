import { strict as assert } from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(
  fileURLToPath(new URL("../..", import.meta.url))
);
const sourceRoot = join(packageRoot, "src");

function source(path: string): string {
  return readFileSync(join(sourceRoot, path), "utf8");
}

test("result compatibility barrel delegates formatting and projections", () => {
  const clientResult = source("client-result.ts");
  assert.equal(existsSync(join(sourceRoot, "result", "formatter.ts")), true);
  assert.equal(existsSync(join(sourceRoot, "result", "cardinality.ts")), true);
  assert.equal(existsSync(join(sourceRoot, "result", "read.ts")), true);
  assert.equal(clientResult.includes("function createResultFormatter"), false);
  assert.match(clientResult, /from ["']\.\/result\/formatter\.ts["']/);
});

test("auxiliary compatibility barrel delegates retry policy", () => {
  const auxiliaries = source("auxiliaries.ts");
  assert.equal(existsSync(join(sourceRoot, "auxiliaries", "retry.ts")), true);
  assert.equal(auxiliaries.includes("export async function withRetry"), false);
  assert.match(auxiliaries, /from ["']\.\/auxiliaries\/retry\.ts["']/);
});

test("gateway adapters consume a dedicated transport contract", () => {
  const gatewayClient = source("gateway/client.ts");
  assert.equal(existsSync(join(sourceRoot, "gateway", "adapter.ts")), true);
  assert.equal(gatewayClient.includes("export interface AthenaGatewayClient"), false);
  assert.match(gatewayClient, /from ["']\.\/adapter\.ts["']/);
});

test("mutation execution is owned by query execution, not fluent builders", () => {
  const fluentMutation = source("client/fluent/mutation-query.ts");
  assert.equal(existsSync(join(sourceRoot, "query", "execution", "mutation.ts")), true);
  assert.equal(fluentMutation.includes("export function createMutationQuery"), false);
  assert.match(fluentMutation, /from ["']\.\.\/\.\.\/query\/execution\/mutation\.ts["']/);
});

test("query execution depends on neutral contracts and owned result modules", () => {
  const executionFiles = [
    "query/execution/operation.ts",
    "query/execution/select.ts",
    "query/execution/mutation.ts",
    "query/execution/canonical-select.ts",
  ];
  for (const file of executionFiles) {
    const contents = source(file);
    assert.doesNotMatch(contents, /client[\\/\\]fluent/);
    assert.doesNotMatch(contents, /client-result\.ts/);
  }
});

test("retry ownership does not depend on its compatibility barrel", () => {
  const retry = source("auxiliaries/retry.ts");
  assert.doesNotMatch(retry, /from ["']\.\.\/auxiliaries\.ts["']/);
});
