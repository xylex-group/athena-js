import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as browserEntry from "../src/browser.ts";

const NODE_ONLY_ERROR_FRAGMENT = "is not available in browser bundles";

test("browser entry keeps core client exports available", () => {
  assert.equal(typeof browserEntry.createClient, "function");
  assert.equal(typeof browserEntry.normalizeAthenaError, "function");
  assert.equal(typeof browserEntry.defineModel, "function");
  assert.equal("AthenaClient" in browserEntry, false);
  assert.equal("createTypedClient" in browserEntry, false);
  assert.equal("createAuthClient" in browserEntry, false);
});

test("browser entry exports storage path helpers and multipart defaults", () => {
  assert.equal(typeof browserEntry.createStorageFileModule, "function");
  assert.equal(typeof browserEntry.resolveStoragePath, "function");
  assert.equal(typeof browserEntry.DEFAULT_MULTIPART_THRESHOLD_BYTES, "number");
  assert.equal(typeof browserEntry.DEFAULT_MULTIPART_PART_SIZE_BYTES, "number");
  assert.ok(browserEntry.DEFAULT_MULTIPART_THRESHOLD_BYTES > 0);
  assert.ok(browserEntry.DEFAULT_MULTIPART_PART_SIZE_BYTES > 0);
});

test("browser entry keeps generator config identity helper", () => {
  assert.equal(typeof browserEntry.generatorEnv, "function");
  assert.equal(typeof browserEntry.athenaAuth, "function");
  assert.equal(typeof browserEntry.ATHENA_AUTH_BASE_ERROR_CODES, "object");
  assert.equal(browserEntry.ATHENA_AUTH_MAX_ADMIN_JSON_BYTES, 32 * 1024);
  assert.equal(browserEntry.ATHENA_AUTH_MAX_ADMIN_JSON_DEPTH, 8);
  assert.equal(browserEntry.ATHENA_AUTH_MAX_TEMPLATE_VARIABLES, 64);
  assert.equal(browserEntry.ATHENA_AUTH_MAX_TEMPLATE_VARIABLE_LENGTH, 128);
  assert.deepEqual(browserEntry.ATHENA_AUTH_ADMIN_LIMITS, {
    maxAdminJsonBytes: 32 * 1024,
    maxAdminJsonDepth: 8,
    maxTemplateVariableLength: 128,
    maxTemplateVariables: 64,
  });

  const config = browserEntry.defineAthenaConfig({
    filter: {
      includeTables: ["users"],
    },
    output: {
      preset: "athena-direct",
      targets: {
        database: "src/lib/athena/generated/relations.ts",
        model: "src/lib/athena/generated/models/{schema_kebab}/{model_kebab}.ts",
        registry: "src/lib/athena/generated/registry.ts",
        schema: "src/lib/athena/generated/schema/{schema_kebab}.ts",
      },
    },
    provider: {
      apiKey: "test-key",
      database: "postgres",
      gatewayUrl: "https://example.com",
      kind: "postgres",
      mode: "gateway",
    },
  });

  assert.equal(config.provider.kind, "postgres");
  assert.equal(config.output.targets?.database, "src/lib/athena/generated/relations.ts");
  assert.deepEqual(config.filter?.includeTables, ["users"]);
});

test("browser entry node-only exports throw explicit errors", async () => {
  assert.throws(
    () =>
      browserEntry.createPostgresIntrospectionProvider({
        connectionString: "postgres://localhost/db",
      }),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT)
  );

  await assert.rejects(
    () => browserEntry.loadGeneratorConfig(),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT)
  );

  await assert.rejects(
    () => browserEntry.runSchemaGenerator(),
    new RegExp(NODE_ONLY_ERROR_FRAGMENT)
  );
});

test("package root export maps browser condition to browser bundle", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    exports: {
      ".": {
        browser?: {
          types?: string;
          import?: string;
          require?: string;
          default?: string;
        };
      };
    };
  };

  assert.equal(pkg.exports["."].browser?.types, "./dist/browser.d.ts");
  assert.equal(pkg.exports["."].browser?.import, "./dist/browser.js");
  assert.equal(pkg.exports["."].browser?.require, "./dist/browser.cjs");
  assert.equal(pkg.exports["."].browser?.default, "./dist/browser.js");
});
