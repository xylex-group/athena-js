import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeAthenaError } from "../../src/auxiliaries.ts";
import { normalizeAthenaErrorForRetry } from "../../src/error/normalize.ts";
import {
  defineAthenaConfig,
  defineGeneratorConfig,
} from "../../src/generator/config.ts";
import {
  toAthenaConfigIr,
  toAthenaGeneratorConfigIr,
} from "../../src/generator/config-ir.ts";
import { parseLegacyBooleanExpression } from "../../src/query/legacy-boolean.ts";

const packagePath = fileURLToPath(
  new URL("../../package.json", import.meta.url)
);

test("T-SUB-001: the package cannot depend on itself", () => {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8")) as {
    name: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  const dependencySections = [
    packageJson.dependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
  ];

  for (const dependencies of dependencySections) {
    const selfDependency = dependencies?.[packageJson.name];
    assert.ok(
      selfDependency === undefined || selfDependency === "link:",
      `${packageJson.name} may use only the development self-link`
    );
  }
});

test("T-SUB-002: retry normalization projects the canonical failure", () => {
  const input = {
    data: null,
    error: {
      kind: "transient",
      message: "provider reported a non-retryable failure",
      retryable: false,
    },
    status: 500,
  };
  const failure = normalizeAthenaError(input);

  assert.deepEqual(normalizeAthenaErrorForRetry(input), {
    kind: failure.kind,
    retryable: failure.retryable,
  });
});

test("T-SUB-003: legacy boolean syntax projects directly to predicate IR", () => {
  const parserSource = readFileSync(
    fileURLToPath(new URL("../../src/query/legacy-boolean.ts", import.meta.url)),
    "utf8"
  );
  assert.doesNotMatch(parserSource, /LegacyBooleanNode|compileLegacyBooleanNode/);
  assert.deepEqual(
    parseLegacyBooleanExpression(
      "and(status.eq.active,deleted.is.null),role.eq.admin"
    ),
    {
      kind: "or",
      nodes: [
        {
          kind: "and",
          nodes: [
            {
              column: "status",
              kind: "compare",
              operator: "eq",
              value: "active",
            },
            {
              column: "deleted",
              kind: "compare",
              operator: "is",
              value: null,
            },
          ],
        },
        {
          column: "role",
          kind: "compare",
          operator: "eq",
          value: "admin",
        },
      ],
    }
  );
});

test("T-SUB-004: declaration output is emitted by source exports, not post-build surgery", () => {
  const tsupSource = readFileSync(
    fileURLToPath(new URL("../../tsup.config.ts", import.meta.url)),
    "utf8"
  );
  const billingSource = readFileSync(
    fileURLToPath(new URL("../../src/billing/index.ts", import.meta.url)),
    "utf8"
  );
  const serverSource = readFileSync(
    fileURLToPath(new URL("../../src/server.ts", import.meta.url)),
    "utf8"
  );

  assert.doesNotMatch(tsupSource, /stamp(?:ServerEmail|BillingCatalog|GeneratedDts)/);
  assert.doesNotMatch(tsupSource, /onSuccess:\s*stampGeneratedDts/);
  assert.match(
    billingSource,
    /export type \{[\s\S]*AthenaBillingCatalogConfig[\s\S]*\} from "\.\/types\.ts"/
  );
  assert.match(serverSource, /consoleEmailProvider/);
});

test("T-SUB-005: table-oriented read-query names are compatibility projections", () => {
  const readQuerySource = readFileSync(
    fileURLToPath(new URL("../../src/query/read-query.ts", import.meta.url)),
    "utf8"
  );
  const compatibilitySource = readFileSync(
    fileURLToPath(
      new URL("../../src/query/read-query-compat.ts", import.meta.url)
    ),
    "utf8"
  );

  assert.doesNotMatch(readQuerySource, /AthenaTable/);
  assert.match(compatibilitySource, /AthenaTableQueryDefinition/);
  assert.match(
    compatibilitySource,
    /from "\.\/read-query\.ts"/
  );
});

test("T-SUB-006: project and generator configs share one raw configuration IR", () => {
  const projectConfig = defineAthenaConfig({
    models: { users: { meta: { model: "users" } } },
    policies: { mode: "observe" },
    tooling: { models: "./models.ts" },
  });
  const generatorConfig = defineGeneratorConfig({
    provider: {
      connectionString: "postgres://localhost/app",
      kind: "postgres",
      mode: "direct",
    },
  });

  assert.deepEqual(toAthenaConfigIr(projectConfig), projectConfig);
  assert.equal(
    toAthenaGeneratorConfigIr(generatorConfig).provider,
    generatorConfig.provider
  );
  assert.notEqual(defineAthenaConfig, defineGeneratorConfig);
});

test("T-SUB-007: table authoring does not depend on legacy defineModel", () => {
  const tableBuilderSource = readFileSync(
    fileURLToPath(new URL("../../src/schema/table-builder.ts", import.meta.url)),
    "utf8"
  );

  assert.doesNotMatch(tableBuilderSource, /defineModel/);
  assert.match(tableBuilderSource, /schemaIrFromModels/);
});

test("T-SUB-008: root and browser barrels share the read-query public projection", () => {
  const publicProjectionSource = readFileSync(
    fileURLToPath(
      new URL("../../src/query/read-query-public.ts", import.meta.url)
    ),
    "utf8"
  );
  const indexSource = readFileSync(
    fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
    "utf8"
  );
  const browserSource = readFileSync(
    fileURLToPath(new URL("../../src/browser.ts", import.meta.url)),
    "utf8"
  );

  assert.match(publicProjectionSource, /read-query\.ts/);
  assert.match(publicProjectionSource, /read-query-compat\.ts/);
  assert.match(indexSource, /export \* from "\.\/query\/read-query-public\.ts"/);
  assert.match(
    browserSource,
    /export \* from "\.\/query\/read-query-public\.ts"/
  );
});
