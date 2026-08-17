import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { createAthenaBrowserClient } from "../../src/next/client.ts";
import {
  buildSdkSurfaceReport,
  inspectAthenaClientSurface,
  listDocumentedAthenaClientMethods,
  parseDocumentedMethodPaths,
  resolveMethodReferencePath,
} from "../src/sdk-surface.ts";

function createProbeClient() {
  return createAthenaBrowserClient({
    backend: { type: "athena" },
    client: "test-client",
    key: "test-key",
    url: "https://mock-athena.local",
  });
}

test("complete-method-reference is parseable and includes athena client paths", () => {
  const referencePath = resolveMethodReferencePath();
  const all = parseDocumentedMethodPaths(referencePath);
  const athena = listDocumentedAthenaClientMethods(referencePath);

  assert.ok(
    all.length >= 600,
    `expected >=600 documented paths, got ${all.length}`
  );
  assert.ok(
    athena.length >= 200,
    `expected >=200 athena.* paths, got ${athena.length}`
  );
  assert.ok(athena.some((path) => path === "athena.from"));
  assert.ok(athena.some((path) => path.startsWith("athena.storage.")));
  assert.ok(athena.some((path) => path.startsWith("athena.auth.")));
  assert.ok(athena.some((path) => path.startsWith("athena.chat.")));
  assert.ok(athena.some((path) => path.startsWith("athena.db.")));
  assert.ok(athena.some((path) => path.startsWith("athena.rpc.")));
});

test("live Athena client covers every documented athena.* method path", () => {
  const client = createProbeClient();
  const coverage = inspectAthenaClientSurface(client);

  assert.equal(
    coverage.missingCount,
    0,
    `missing methods (${coverage.missingCount}):\n${coverage.missing.join("\n")}`
  );
  assert.equal(
    coverage.presentCount,
    coverage.source.documentedAthenaMethodCount
  );
  assert.ok(coverage.livePaths.includes("athena.from"));
  assert.ok(
    coverage.livePaths.some((path) => path.startsWith("athena.storage."))
  );
});

test("buildSdkSurfaceReport marks coverage complete for full method inventory", () => {
  const report = buildSdkSurfaceReport(createProbeClient());

  assert.equal(report.coverage.complete, true);
  assert.equal(report.coverage.missingCount, 0);
  assert.equal(report.namespaces.from, true);
  assert.equal(report.namespaces.storage, true);
  assert.equal(report.namespaces.auth, true);
  assert.equal(report.namespaces.chat, true);
  assert.equal(report.namespaces.billing, true);
  assert.equal(report.methods.eq, true);
  assert.equal(report.methods.in, true);
  assert.equal(report.methods.findMany, true);
  assert.equal(report.methods.rpc.eq, true);
  assert.equal(report.methods.rpc.select, true);
});
