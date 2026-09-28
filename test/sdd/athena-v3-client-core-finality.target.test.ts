import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..", "..", "src");

function readSource(relativePath: string): string {
  return readFileSync(join(srcRoot, relativePath), "utf8");
}

test("Runtime Plan does not embed the original public config", () => {
  const plan = readSource("runtime/plan/types.ts");
  assert.doesNotMatch(plan, /\bconfig\s*:\s*unknown\b/);
  assert.doesNotMatch(plan, /\b(rawConfig|originalConfig)\b/);
  assert.doesNotMatch(
    readSource("runtime/plan/materialize.ts"),
    /interface\s+AthenaMaterializedRuntime\s*\{[^}]*\bconfig\s*:/
  );
});

test("plan and materializer layers do not depend on the public client façade", () => {
  const files = [
    "runtime/plan/normalize.ts",
    "runtime/plan/resolve.ts",
    "runtime/plan/validate.ts",
    "runtime/plan/materialize.ts",
    "runtime/materializers/billing.ts",
    "runtime/materializers/chat.ts",
    "runtime/materializers/database.ts",
    "runtime/materializers/storage.ts",
  ];

  for (const relativePath of files) {
    assert.doesNotMatch(
      readSource(relativePath),
      /(?:from|import)\s+["'][^"']*v3-client(?:-core)?\.ts["']/,
      relativePath
    );
  }
});

test("universal client construction is owned by client/create-client", () => {
  const source = readSource("client/create-client.ts");
  assert.doesNotMatch(
    source,
    /(?:from|import)\s+["'][^"']*v3-client-core\.ts["']/
  );
});

test("client contracts and normalization do not reverse-depend on the façade", () => {
  for (const relativePath of [
    "client/contracts.ts",
    "client/config/normalize.ts",
    "client/config/predicates.ts",
  ]) {
    assert.doesNotMatch(
      readSource(relativePath),
      /(?:from|import)\s+["'][^"']*v3-client-core\.ts["']/,
      relativePath
    );
  }
});

test("client contracts do not reference the public client façade", () => {
  assert.doesNotMatch(readSource("client/contracts.ts"), /\.\.\/client\.ts/);
});

test("the canonical client contract keeps request asynchronous", () => {
  const contracts = readSource("client/contracts.ts");
  assert.match(
    contracts,
    /request:\s*<T\s*=\s*unknown>\([\s\S]*?\)\s*=>\s*Promise<AthenaRequestResponse<T>>/
  );
});

test("canonical public contracts preserve Docs API JSDoc", () => {
  const contracts = readSource("client/contracts.ts");
  assert.match(
    contracts,
    /\/\*\*\s*\n\s*\* Auth service config on \{@link createClient\}[\s\S]*?\*\/\s*export interface AthenaAuthConfig/
  );
  assert.match(
    contracts,
    /\/\*\*\s*\n\s*\* Cloudflare D1 binding \(e\.g\. `env\.DB`\)\.[\s\S]*?\*\/\s*d1\?:/
  );
  assert.match(
    contracts,
    /\/\*\*\s*\n\s*\* Executes raw SQL through Athena's compatibility query surface\.[\s\S]*?@deprecated Will be removed in Athena 6\.0\.0\.[\s\S]*?\*\/\s*query:/
  );
});

test("Docs API keeps the root query deprecation metadata", () => {
  const docs = JSON.parse(
    readFileSync(
      join(here, "..", "..", "docs", "generated", "api.v2.json"),
      "utf8"
    )
  ) as {
    entrypoints: Array<{
      symbols: Array<{
        name: string;
        deprecated: boolean;
        replacement?: string;
      }>;
    }>;
  };
  const queryMembers = docs.entrypoints
    .flatMap((entrypoint) => entrypoint.symbols)
    .filter((symbol) => symbol.name === "athena.query");

  assert.ok(queryMembers.length > 0);
  for (const query of queryMembers) {
    assert.equal(query.deprecated, true);
    assert.equal(
      query.replacement,
      "Will be removed in Athena 6.0.0. Use `admin.query()` for explicit operation and expected-shape metadata, or `db.query()` for the compatibility result shape."
    );
  }
});

test("the façade re-exports canonical contracts instead of redeclaring them", () => {
  const façade = readSource("v3-client-core.ts");
  for (const name of [
    "AthenaRequestContext",
    "AthenaDbConfig",
    "AthenaAuthConfig",
    "AthenaChatConfig",
    "AthenaStorageConfig",
    "AthenaClientRuntimeConfig",
    "AthenaClientServicesConfig",
    "AthenaClientConfig",
    "AthenaClient",
  ]) {
    assert.doesNotMatch(
      façade,
      new RegExp(`export\\s+(?:interface|type)\\s+${name}\\b`),
      name
    );
  }
  assert.match(
    façade,
    /export\s+type\s*\{[\s\S]*AthenaClientConfig[\s\S]*\}\s+from\s+["']\.\/client\/contracts\.ts["']/
  );
});

test("client construction does not launder façade dependencies through shims", () => {
  const createClient = readSource("client/create-client.ts");
  const notifications = readSource("client/compose/notifications.ts");
  assert.match(
    createClient,
    /export\s+function\s+createClientWithNormalizer\b/
  );
  assert.doesNotMatch(createClient, /from\s+["'][^"']*client\/view\.ts["']/);
  assert.match(
    notifications,
    /function\s+replaceClientNotificationPreferenceStore\b/
  );
  assert.doesNotMatch(notifications, /export\s*\{[^}]*v3-client-core/);
});

test("client construction graph has no transitive façade dependency", () => {
  const importPattern = /(?:from|import)\s*["']([^"']+)["']/g;
  const seen = new Set<string>();
  const pending = ["client/create-client.ts"];

  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (!relativePath || seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);
    const source = readSource(relativePath);
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) {
        continue;
      }
      const candidate = resolve(srcRoot, dirname(relativePath), specifier);
      const next = relative(srcRoot, candidate).replaceAll("\\", "/");
      const normalized = next.endsWith(".ts") ? next : `${next}.ts`;
      if (!existsSync(join(srcRoot, normalized))) {
        continue;
      }
      assert.notEqual(normalized, "v3-client-core.ts");
      pending.push(normalized);
    }
  }
});
