import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { extractDocsApi } from "../scripts/docs/extract-api.mts";
import {
  parseTsupEntryMap,
  readPackageJson,
  resolvePublishedExports,
} from "../scripts/docs/extract-exports.mts";
import { validateDocsApi } from "../scripts/docs/validate-api.mts";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("docs API discovery uses package.json exports, not tsup-only entries", () => {
  const pkg = readPackageJson(packageRoot);
  const resolved = resolvePublishedExports({
    packageRoot,
    packageName: pkg.name,
    exports: pkg.exports,
  });
  const keys = resolved.map((item) => item.exportKey);
  assert.ok(keys.includes("./server"));
  assert.ok(keys.includes("./next/client"));
  assert.ok(!keys.includes("./cli"));
  assert.ok(!keys.includes("./cli/index"));

  const tsup = parseTsupEntryMap(packageRoot);
  assert.ok(tsup["cli/index"]);
  assert.equal(
    resolved.some((item) => item.source === tsup["cli/index"]),
    false,
  );
});

test("extractDocsApi includes every published export key", () => {
  const pkg = readPackageJson(packageRoot);
  const ir = extractDocsApi(packageRoot);
  const exportKeys = Object.keys(pkg.exports).filter(
    (key) => key !== "./package.json",
  );
  const irKeys = new Set(ir.entrypoints.map((item) => item.exportKey));
  for (const key of exportKeys) {
    assert.ok(irKeys.has(key), `missing export in IR: ${key}`);
  }
  const server = ir.entrypoints.find((item) => item.exportKey === "./server");
  assert.ok(server);
  assert.equal(server?.runtimeClassification, "explicit");
  assert.equal(server?.runtime.node, "supported");
  const policy = ir.entrypoints.find((item) => item.exportKey === "./policy");
  assert.equal(policy?.runtime.node, "supported");
  assert.equal(policy?.runtime.browser, "supported");
  assert.equal(policy?.runtime.workerd, "supported");
  const rights = ir.entrypoints.find((item) => item.exportKey === "./rights");
  assert.equal(rights?.runtime.node, "supported");
  assert.equal(rights?.runtime.browser, "supported");
  const capabilities = ir.entrypoints.find(
    (item) => item.exportKey === "./capabilities",
  );
  assert.equal(capabilities?.runtimeClassification, "explicit");
  assert.equal(capabilities?.runtime.node, "supported");
  assert.equal(capabilities?.runtime.browser, "supported");
  assert.equal(capabilities?.runtime.workerd, "supported");
  assert.ok(server?.symbols.some((item) => item.name === "createClient"));
  const createClient = server?.symbols.find(
    (item) => item.name === "createClient",
  );
  assert.equal(createClient?.tags.canonical, true);
  assert.equal(createClient?.tags.role, "root-client-constructor");
  const coverage = validateDocsApi(ir, {
    packageRoot,
    exports: pkg.exports,
  });
  assert.equal(coverage.unknownEntrypoints.length, 0);
  assert.ok(coverage.canonical >= 1);
  const stale = validateDocsApi(
    {
      ...ir,
      source: { packageJsonDigest: "0".repeat(64) },
    },
    { packageRoot, exports: pkg.exports },
  );
  assert.ok(stale.errors.some((item) => item.includes("packageJsonDigest")));
});

test("generated Docs API manifest declares the extracted canonical artifact", () => {
  const ir = extractDocsApi(packageRoot);
  const manifest = JSON.parse(
    readFileSync(
      join(packageRoot, "docs", "generated", "manifest.json"),
      "utf8",
    ),
  ) as { schema: string; artifact: string };
  assert.deepEqual(manifest, {
    schema: ir.schema,
    artifact: "api.v2.json",
  });
});

test("public-unlisted members remain in IR", () => {
  const ir = extractDocsApi(packageRoot);
  const unlisted = ir.entrypoints.flatMap((entry) =>
    entry.symbols.filter((item) => item.classification === "public-unlisted"),
  );
  assert.ok(unlisted.length > 0);
  assert.ok(unlisted.every((item) => item.id.includes("#")));
});

test("nested client members are reachable from createClient", () => {
  const ir = extractDocsApi(packageRoot);
  const server = ir.entrypoints.find((item) => item.exportKey === "./server");
  const names = new Set(server?.symbols.map((item) => item.name));
  assert.ok(
    [...names].some((name) => name.startsWith("athena.")),
    "expected reachable athena.* members",
  );
});
