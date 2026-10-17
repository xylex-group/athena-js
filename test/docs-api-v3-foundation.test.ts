import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { extractDocsApi } from "../scripts/docs/extract-api.mts";
import {
  composeDocsApiV3,
  readDocsApiV3Structurally,
  readValidatedDocsApiV3Artifacts,
  stableDocsApiV3Stringify,
} from "../scripts/docs/v3/compose.mts";
import {
  type DocsApiV3Artifacts,
  type DocsApiV3Authorities,
  type DocsAuthorizationExpression,
  docsApiV3JsonSchema,
  parseDocsApiManifestV3,
  validateDocsApiV3,
} from "../scripts/docs/v3/schema.mts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest: DocsApiV3Artifacts["manifest"] = {
  artifacts: {
    bindings: "bindings.v3.json",
    examples: "examples.v3.json",
    semantic: "semantic.v3.json",
    symbols: "symbols.v3.json",
  },
  package: { name: "@xylex-group/athena", version: "5.7.2" },
  schema: "athena/docs-api/v3",
  source: { inputsDigest: "b".repeat(64), packageJsonDigest: "a".repeat(64) },
};

function validArtifacts(): DocsApiV3Artifacts {
  return {
    bindings: {
      bindings: [
        {
          deprecated: false,
          frameworks: [],
          id: "binding:auth.read",
          importPath: "@xylex-group/athena/browser",
          language: "typescript",
          operationId: "auth.read",
          package: "@xylex-group/athena",
          runtime: {
            browser: "supported",
            node: "unsupported",
            reactNative: "unsupported",
            workerd: "unsupported",
          },
          signature: "() => Promise<void>",
          source: "src/auth/read.ts",
          symbolPath: "athena.auth.read",
        },
      ],
      schema: "athena/docs-api/v3/bindings",
    },
    examples: { examples: [], schema: "athena/docs-api/v3/examples" },
    manifest,
    semantic: {
      capabilities: [],
      concepts: [],
      domains: [
        {
          id: "auth",
          provenance: {
            inputs: [
              { digest: "e".repeat(64), id: "auth-domain", kind: "source" },
            ],
          },
          title: "Auth",
        },
      ],
      errors: [],
      operations: [
        {
          authorization: {
            condition: {
              op: "any",
              terms: [
                { key: "auth.read", op: "right" },
                { key: "auth.admin", op: "right" },
              ],
            },
            principal: "session",
          },
          bindingIds: ["binding:auth.read"],
          capabilityRefs: [],
          conceptIds: [],
          domainId: "auth",
          errorRefs: [],
          id: "auth.read",
          kind: "read",
          lifecycle: { status: "canonical" },
          provenance: {
            inputs: [{ digest: "c".repeat(64), id: "auth", kind: "catalog" }],
          },
          realizations: [],
          summary: "Read a record.",
          title: "Read",
          transports: [],
        },
      ],
      schema: "athena/docs-api/v3/semantic",
    },
    symbols: {
      schema: "athena/docs-api/v3/symbols",
      symbols: [
        {
          bindingIds: ["binding:auth.read"],
          classification: "documented",
          deprecated: false,
          examples: [],
          id: "symbol:auth.read",
          kind: "function",
          name: "athena.auth.read",
          related: [],
          source: "src/auth/read.ts",
          summary: "Read a record.",
          tags: {},
        },
      ],
    },
  };
}

function validationAuthorities(
  rightKeys: readonly string[] = ["auth.read", "auth.admin"],
  inputDigests: ReadonlyMap<string, string> = new Map([
    ["auth-domain", "e".repeat(64)],
    ["auth", "c".repeat(64)],
  ])
): DocsApiV3Authorities {
  return { inputDigests, rightKeys: new Set(rightKeys) };
}

test("V3 manifest parser rejects V2 and unknown fields", () => {
  assert.throws(() =>
    parseDocsApiManifestV3({ ...manifest, schema: "athena/docs-api/v2" })
  );
  assert.throws(() =>
    parseDocsApiManifestV3({ ...manifest, undocumented: true })
  );
  assert.equal(parseDocsApiManifestV3(manifest).schema, "athena/docs-api/v3");
});

test("V3 semantic validation rejects unknown Rights and stale provenance", () => {
  assert.throws(
    () =>
      validateDocsApiV3(validArtifacts(), validationAuthorities(["auth.read"])),
    /unknown Right key: auth.admin/
  );
  assert.throws(
    () =>
      validateDocsApiV3(
        validArtifacts(),
        validationAuthorities(
          ["auth.read", "auth.admin"],
          new Map([
            ["auth-domain", "e".repeat(64)],
            ["auth", "d".repeat(64)],
          ])
        )
      ),
    /stale provenance digest/
  );
});

test("V3 semantic validation rejects duplicate operations and dangling bindings", () => {
  const artifacts = validArtifacts();
  artifacts.semantic.operations.push({ ...artifacts.semantic.operations[0] });
  artifacts.semantic.operations[0].bindingIds = ["binding:missing"];
  assert.throws(
    () => validateDocsApiV3(artifacts, validationAuthorities()),
    /duplicate operation id: auth.read/
  );
});

test("V3 semantic validation rejects stale concept, error, and capability references", () => {
  const artifacts = validArtifacts();
  const operation = artifacts.semantic.operations[0];
  assert.ok(operation);
  operation.conceptIds.push("auth.missing-concept");
  operation.errorRefs.push("ATHENA_MISSING_ERROR");
  operation.capabilityRefs.push({ id: "missing-capability" });
  let message = "";
  try {
    validateDocsApiV3(artifacts, validationAuthorities());
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /unknown concept auth.missing-concept/);
  assert.match(message, /unknown error ATHENA_MISSING_ERROR/);
  assert.match(message, /unknown capability missing-capability/);
});

test("V3 semantic validation rejects duplicate binding IDs", () => {
  const artifacts = validArtifacts();
  const binding = artifacts.bindings.bindings[0];
  assert.ok(binding);
  artifacts.bindings.bindings.push({ ...binding });
  assert.throws(
    () => validateDocsApiV3(artifacts, validationAuthorities()),
    /duplicate binding id: binding:auth.read/
  );
});

test("V3 preserves disjunctive authorization as an any expression", () => {
  const parsed = validateDocsApiV3(validArtifacts(), validationAuthorities());
  assert.deepEqual(parsed.semantic.operations[0]?.authorization?.condition, {
    op: "any",
    terms: [
      { key: "auth.read", op: "right" },
      { key: "auth.admin", op: "right" },
    ],
  });
  const typedCondition: DocsAuthorizationExpression | undefined =
    parsed.semantic.operations[0]?.authorization?.condition;
  assert.equal(typedCondition?.op, "any");
});

test("V3 structural and authoritative readers have explicit boundaries", () => {
  const artifacts = validArtifacts();
  const path = join(packageRoot, ".docs-v3-rights-loader-fixture");
  const generated = join(path, "docs", "generated");
  mkdirSync(generated, { recursive: true });
  try {
    for (const [name, value] of [
      ["bindings.v3.json", artifacts.bindings],
      ["examples.v3.json", artifacts.examples],
      ["manifest.v3.json", artifacts.manifest],
      ["semantic.v3.json", artifacts.semantic],
      ["symbols.v3.json", artifacts.symbols],
    ] as const) {
      writeFileSync(join(generated, name), JSON.stringify(value));
    }
    const loaded = readDocsApiV3Structurally(path);
    assert.equal(loaded.semantic.operations[0]?.id, "auth.read");
    assert.throws(
      () =>
        readValidatedDocsApiV3Artifacts(
          path,
          validationAuthorities(["auth.read"])
        ),
      /unknown Right key: auth.admin/
    );
    assert.equal(
      readValidatedDocsApiV3Artifacts(path, validationAuthorities()).semantic
        .operations[0]?.id,
      "auth.read"
    );
  } finally {
    rmSync(path, { force: true, recursive: true });
  }
});

test("V3 transport is a closed discriminated union", () => {
  const artifacts = validArtifacts();
  const operation = artifacts.semantic.operations[0];
  assert.ok(operation);
  operation.transports = [
    { kind: "http", method: "POST", path: "/auth/read" },
    { kind: "websocket", protocol: "athena.auth.v1" },
    { capability: "auth.read", kind: "mcp" },
    { kind: "local" },
  ];
  assert.doesNotThrow(() =>
    validateDocsApiV3(artifacts, validationAuthorities())
  );

  for (const invalid of [
    { kind: "http" },
    { kind: "http", method: "GET", path: "/auth/read", protocol: "bad" },
    { kind: "local", method: "DELETE", path: "/users" },
    { kind: "mcp", protocol: "bad" },
  ]) {
    const malformed = structuredClone(artifacts);
    const malformedOperation = malformed.semantic.operations[0] as unknown as {
      transports: unknown[];
    };
    malformedOperation.transports = [invalid];
    assert.throws(() => validateDocsApiV3(malformed, validationAuthorities()));
  }
});

test("V3 validation rejects unknown runtime classifications", () => {
  const artifacts = validArtifacts();
  const binding = artifacts.bindings.bindings[0];
  assert.ok(binding);
  binding.runtime.workerd = "unknown";
  assert.throws(
    () => validateDocsApiV3(artifacts, validationAuthorities()),
    /unknown runtime classification/
  );
});

test("V3 artifact loader fails closed when any shard is missing", () => {
  assert.throws(() =>
    readDocsApiV3Structurally(join(packageRoot, ".missing-docs-v3-fixture"))
  );
});

test("V3 JSON Schema is generated from the strict TypeScript contract", () => {
  const path = join(
    packageRoot,
    "..",
    "..",
    "docs",
    "contracts",
    "docs-api.v3.schema.json"
  );
  const checkedIn = JSON.parse(readFileSync(path, "utf8")) as unknown;
  assert.deepEqual(checkedIn, docsApiV3JsonSchema());
});

test("V3 runtime bindings reuse explicit V2 classifications deterministically", () => {
  const ir = extractDocsApi(packageRoot);
  const first = composeDocsApiV3(packageRoot, ir);
  const second = composeDocsApiV3(packageRoot, ir);
  assert.equal(
    stableDocsApiV3Stringify(first),
    stableDocsApiV3Stringify(second)
  );
  const root = first.bindings.bindings.find(
    (binding) => binding.importPath === "@xylex-group/athena"
  );
  assert.deepEqual(root?.runtime, {
    browser: "supported",
    node: "supported",
    reactNative: "unsupported",
    workerd: "unsupported",
  });
  assert.ok(first.symbols.symbols.length >= 5803);
  for (const ids of [
    first.semantic.domains.map(({ id }) => id),
    first.semantic.concepts.map(({ id }) => id),
    first.semantic.operations.map(({ id }) => id),
    first.bindings.bindings.map(({ id }) => id),
    first.symbols.symbols.map(({ id }) => id),
    first.examples.examples.map(({ id }) => id),
  ]) {
    assert.deepEqual(ids, [...ids].sort());
  }
});

test("V3 enforces the frozen V2 snapshot and coverage baseline", () => {
  const fixtureRoot = join(
    packageRoot,
    "..",
    "..",
    "docs",
    "sdd",
    "xylex",
    "athena-docs-api-ir-v3",
    "specs",
    "fixtures"
  );
  const snapshotManifest = JSON.parse(
    readFileSync(join(fixtureRoot, "SNAPSHOT-MANIFEST.json"), "utf8")
  ) as { files: Array<{ path: string; sha256: string }> };
  const loadJson = (path: string): Record<string, unknown> =>
    JSON.parse(readFileSync(join(fixtureRoot, path), "utf8")) as Record<
      string,
      unknown
    >;
  for (const file of snapshotManifest.files) {
    const bytes = readFileSync(join(fixtureRoot, file.path));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
      `frozen fixture digest changed: ${file.path}`
    );
  }

  const baselineIr = loadJson("api.v2.json");
  const currentIr = extractDocsApi(packageRoot);
  const baselineEntrypoints = baselineIr.entrypoints as Array<{
    importPath: string;
    exportKey: string;
    runtime: unknown;
    symbols: Array<{
      id: string;
      name: string;
      kind: string;
      source: string | null;
      runtime?: unknown;
    }>;
  }>;
  const currentByEntrypoint = new Map(
    currentIr.entrypoints.map((entrypoint) => [
      `${entrypoint.importPath}#${entrypoint.exportKey}`,
      entrypoint,
    ])
  );
  for (const baseline of baselineEntrypoints) {
    const key = `${baseline.importPath}#${baseline.exportKey}`;
    const current = currentByEntrypoint.get(key);
    assert.ok(current, `frozen V2 entrypoint disappeared: ${key}`);
    assert.deepEqual(
      current.runtime,
      baseline.runtime,
      `runtime changed for ${key}`
    );
    const currentSymbols = new Map(
      current.symbols.map((symbol) => [symbol.id, symbol])
    );
    for (const symbol of baseline.symbols) {
      const actual = currentSymbols.get(symbol.id);
      assert.ok(actual, `frozen V2 symbol disappeared: ${symbol.id}`);
      assert.deepEqual(
        {
          id: actual.id,
          kind: actual.kind,
          name: actual.name,
          runtime: actual.runtime,
          source: actual.source,
        },
        {
          id: symbol.id,
          kind: symbol.kind,
          name: symbol.name,
          runtime: symbol.runtime,
          source: symbol.source,
        },
        `contract-sensitive V2 symbol changed: ${symbol.id}`
      );
    }
  }

  const baselineCoverage = loadJson("coverage.json");
  const currentCoverage = JSON.parse(
    readFileSync(
      join(packageRoot, "docs", "generated", "coverage.json"),
      "utf8"
    )
  ) as Record<string, unknown>;
  assert.equal(currentCoverage.package, baselineCoverage.package);
  assert.ok(
    Number(currentCoverage.publicSymbols) >=
      Number(baselineCoverage.publicSymbols)
  );
  assert.deepEqual(currentCoverage.unknownRuntimes, []);
  assert.deepEqual(currentCoverage.errors, []);
});
