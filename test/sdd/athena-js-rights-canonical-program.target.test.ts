import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { produceAthenaDevtoolsAuthorizationInspectorSync } from "../../src/devtools/produce/authorization.ts";
import { createAthenaCanonicalInspectionPort } from "../../src/devtools/server-ir.ts";
import type { AthenaRightContribution } from "../../src/rights/contribution.ts";
import { fingerprintAthenaRightsIr } from "../../src/rights/ir/fingerprint.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";
import { resolveAthenaRightsIr } from "../../src/rights/resolver.ts";
import {
  ATHENA_RIGHTS_IR_KIND,
  ATHENA_RIGHTS_IR_VERSION,
  type AthenaRightDefinition,
} from "../../src/rights/types.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  getAthenaAuthorizationRightsIr,
} from "../../src/runtime/authorization/catalog.ts";
import { authorizationRightsFingerprint } from "../../src/runtime/authorization/catalog-state.ts";
import {
  attachAthenaClientInternals,
  createRootClientInternals,
} from "../../src/runtime/client-internals.ts";

function definition(
  key: string,
  overrides: Partial<Omit<AthenaRightDefinition, "key">> = {}
): AthenaRightDefinition {
  return {
    assignable: true,
    description: "Read records",
    displayName: "Read records",
    domain: "data",
    key: parseAthenaRightKey(key),
    riskLevel: "low",
    scopeKind: "self",
    ...overrides,
  };
}

function contribution(
  key: string,
  source: string,
  overrides: Partial<Omit<AthenaRightDefinition, "key">> = {}
): AthenaRightContribution {
  return { definition: definition(key, overrides), source };
}

test("resolves equal same-key contributions into one canonical definition", () => {
  const resolved = resolveAthenaRightsIr([
    contribution("data.records.read", "data"),
    contribution("data.records.read", "authorization"),
    contribution("data.records.list", "data"),
  ]);

  assert.equal(resolved.kind, ATHENA_RIGHTS_IR_KIND);
  assert.equal(resolved.irVersion, ATHENA_RIGHTS_IR_VERSION);
  assert.deepEqual(
    resolved.rights.map((right) => right.key),
    ["data.records.list", "data.records.read"]
  );
  assert.deepEqual(resolved.metadata, {
    provenance: ["authorization", "data"],
  });
});

test("rejects conflicting same-key contributions instead of using last-write-wins", () => {
  assert.throws(
    () =>
      resolveAthenaRightsIr([
        contribution("data.records.read", "data"),
        contribution("data.records.read", "billing", {
          riskLevel: "critical",
        }),
      ]),
    /Conflicting Right contributions/
  );
});

test("rejects blank or malformed contributor provenance", () => {
  assert.throws(
    () => resolveAthenaRightsIr([contribution("data.records.read", "")]),
    /Invalid Right contribution source/
  );
  assert.throws(
    () =>
      resolveAthenaRightsIr([contribution("data.records.read", "data")], {
        provenance: ["   "],
      }),
    /provenance/
  );
});

test("resolver does not mutate contributions or metadata", () => {
  const contributions = [
    contribution("data.records.read", "data"),
    contribution("data.records.list", "data"),
  ];
  const metadata = { provenance: ["runtime"] };
  const before = structuredClone(contributions);

  resolveAthenaRightsIr(contributions, metadata);

  assert.deepEqual(contributions, before);
  assert.deepEqual(metadata, { provenance: ["runtime"] });
});

test("authorization catalog is a projection of one canonical Rights document", () => {
  const rightsIr = getAthenaAuthorizationRightsIr();

  assert.equal(rightsIr.kind, ATHENA_RIGHTS_IR_KIND);
  assert.equal(AUTHORIZATION_CATALOG_VERSION, 5);
  assert.equal(Object.isFrozen(rightsIr), true);
  assert.equal(Object.isFrozen(rightsIr.rights), true);
  assert.equal(
    fingerprintAthenaRightsIr(rightsIr),
    authorizationRightsFingerprint()
  );
  assert.deepEqual(rightsIr.rights, getAthenaAuthorizationRightsIr().rights);
});

test("canonical inspection exposes the canonical Rights document", async () => {
  const root = {};
  attachAthenaClientInternals(
    root,
    createRootClientInternals({
      capabilitiesFingerprint: undefined,
      capabilitiesIr: undefined,
      config: {} as never,
      plan: {} as never,
    })
  );

  const artifact = await createAthenaCanonicalInspectionPort(
    root as never
  ).read("rights");

  assert.equal(artifact?.descriptor.available, true);
  assert.equal(artifact?.descriptor.version, ATHENA_RIGHTS_IR_VERSION);
  assert.equal(
    artifact?.descriptor.fingerprint,
    fingerprintAthenaRightsIr(getAthenaAuthorizationRightsIr())
  );
  assert.deepEqual(artifact?.document, getAthenaAuthorizationRightsIr());
});

test("DevTools authorization catalog projects the canonical Rights fingerprint", () => {
  const inspector = produceAthenaDevtoolsAuthorizationInspectorSync();
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "src",
      "devtools",
      "produce",
      "authorization.ts"
    ),
    "utf8"
  );

  assert.equal(
    inspector.catalog.fingerprint,
    fingerprintAthenaRightsIr(getAthenaAuthorizationRightsIr())
  );
  assert.match(source, /getAthenaAuthorizationRightsIr/);
  assert.match(source, /fingerprintAthenaRightsIr/);
  assert.doesNotMatch(source, /createHash/);
});

test("pure Right contribution catalogs do not depend on enforcement runtimes", () => {
  for (const file of [
    join(packageRoot(), "src", "rights", "definitions.ts"),
    join(packageRoot(), "src", "billing", "rights-catalog.ts"),
    join(packageRoot(), "src", "storage", "rights-catalog.ts"),
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /runtime[\\/]authorization/);
    assert.doesNotMatch(source, /runtime[\\/]rights/);
  }
});

test("Rights core does not aggregate Billing or Storage catalogs", () => {
  const source = readFileSync(
    join(packageRoot(), "src", "rights", "definitions.ts"),
    "utf8"
  );
  assert.doesNotMatch(source, /from ["']\.\.\/billing\//);
  assert.doesNotMatch(source, /from ["']\.\.\/storage\//);
});

function packageRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
