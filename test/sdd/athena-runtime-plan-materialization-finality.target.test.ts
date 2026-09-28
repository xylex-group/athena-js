import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "../../src/v3-client.ts";
import { athenaRuntimeCounters } from "../../src/runtime/ownership.ts";

const packageRoot = join(
  fileURLToPath(new URL("../../", import.meta.url)),
);
const sourceRoot = join(packageRoot, "src");
const constructionRoot = join(sourceRoot, "runtime", "construction");
const materializersRoot = join(sourceRoot, "runtime", "materializers");

function readSource(relativePath: string): string {
  return readFileSync(join(sourceRoot, relativePath), "utf8");
}

test("construction boundary owns plan and opaque resources", async () => {
  const typesPath = join(constructionRoot, "types.ts");
  const resolverPath = join(constructionRoot, "resolve.ts");
  assert.equal(existsSync(typesPath), true);
  assert.equal(existsSync(resolverPath), true);

  const types = readFileSync(typesPath, "utf8");
  const resolver = readFileSync(resolverPath, "utf8");
  assert.match(types, /export\s+(?:type|interface)\s+AthenaRuntimeResources\b/);
  assert.match(
    types,
    /export\s+(?:type|interface)\s+ResolvedAthenaConstruction\b/,
  );
  const resourceTypes = types.slice(
    0,
    types.indexOf("export interface AthenaStorageBindingPatch"),
  );
  for (const forbiddenResourceField of [
    "hasRemoteAuth",
    "hasRemoteServices",
    "modeIsGateway",
    "requestedKey",
    "pgUri",
    "capabilities",
    "bucket",
    "prefix",
    "root",
    "applicationId",
    "configuredProviders",
    "testMode",
  ]) {
    assert.doesNotMatch(
      resourceTypes,
      new RegExp(`readonly\\s+${forbiddenResourceField}\\??\\s*:`),
      `resource vocabulary must not duplicate semantic field ${forbiddenResourceField}`,
    );
  }
  assert.match(resolver, /export\s+(?:async\s+)?function\s+resolveAthenaConstruction\b/);

  const construction = (await import(
    new URL("../../src/runtime/construction/resolve.ts", import.meta.url).href
  )) as Record<string, unknown>;
  assert.equal(typeof construction.resolveAthenaConstruction, "function");
});

test("runtime materializers consume plan resources instead of client config", () => {
  const materializers = [
    "database.ts",
    "storage.ts",
    "chat.ts",
    "billing.ts",
  ] as const;

  for (const file of materializers) {
    const source = readFileSync(join(materializersRoot, file), "utf8");
    assert.equal(
      source.includes('from "../../client/contracts.ts"'),
      false,
      `${file} must not import AthenaClientConfig`,
    );
  }

  assert.equal(
    readSource("runtime/materializers/chat.ts").includes("resolveChatMode"),
    false,
  );
  assert.equal(
    readSource("runtime/materializers/billing.ts").includes("ATHENA_ENV_"),
    false,
  );
  assert.equal(
    readSource("runtime/materializers/database.ts").includes(
      'next.billing =',
    ),
    false,
  );
});

test("config-transform materialization seam is removed", () => {
  const materialize = readSource("runtime/plan/materialize.ts");
  assert.equal(materialize.includes("materializeRuntimeWithConfig"), false);
  assert.equal(
    materialize.includes("materializeRuntime<TModels"),
    false,
  );
  assert.match(materialize, /materializeRuntimePlan/);
});

test("request views do not re-enter runtime materialization", () => {
  const clientCore = readSource("client/create-client.ts");
  assert.equal(clientCore.includes("materializeRuntime"), false);
  assert.equal(clientCore.includes("materializeDatabase"), false);
  assert.equal(clientCore.includes("materializeStorage"), false);
  assert.equal(clientCore.includes("materializeChat"), false);
  assert.equal(clientCore.includes("materializeBilling"), false);
});

test("root materializes once and nested request views only borrow it", async () => {
  const before = athenaRuntimeCounters().runtimePlansMaterialized;
  const root = createClient({
    key: "ak_runtime_finality",
    url: "https://athena.example",
  });
  const afterRoot = athenaRuntimeCounters().runtimePlansMaterialized;
  const view = root.withContext({ userId: "runtime-finality-user" });
  view.withContext({ organizationId: "org-1" });

  assert.equal(afterRoot, before + 1);
  assert.equal(athenaRuntimeCounters().runtimePlansMaterialized, afterRoot);

  await root.close();
});
