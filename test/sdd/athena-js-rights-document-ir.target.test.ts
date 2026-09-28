import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalizeAthenaRightsIr,
  fingerprintAthenaRightsIr,
  validateAthenaRightsIr,
} from "../../src/rights/ir/index.ts";
import {
  parseAthenaRightKey,
  type AthenaRightKey,
} from "../../src/rights/key.ts";
import type {
  AthenaRightDefinition,
  AthenaRightsIr,
} from "../../src/rights/types.ts";
import {
  ATHENA_RIGHTS_IR_KIND,
  ATHENA_RIGHTS_IR_VERSION,
} from "../../src/rights/types.ts";

function right(
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

function document(
  rights: readonly AthenaRightDefinition[] = [right("data.records.read")],
  metadata: AthenaRightsIr["metadata"] = {}
): AthenaRightsIr {
  return {
    kind: ATHENA_RIGHTS_IR_KIND,
    irVersion: ATHENA_RIGHTS_IR_VERSION,
    metadata,
    rights,
  };
}

test("validates a versioned Rights document with explicit semantic fields", () => {
  const value = document();

  assert.doesNotThrow(() => validateAthenaRightsIr(value));
  assert.equal(validateAthenaRightsIr(value).rights[0]?.key, "data.records.read");
});

test("rejects unknown document, metadata, and Right fields", () => {
  assert.throws(
    () =>
      validateAthenaRightsIr({
        ...document(),
        extra: true,
      }),
    /unknown field/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr({
        ...document([], { provenance: ["catalog"] }),
        metadata: { provenance: ["catalog"], generatedAt: "today" },
      }),
    /unknown field/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr({
        ...document([right("data.records.read")]),
        rights: [{ ...right("data.records.read"), extra: true }],
      }),
    /unknown field/
  );
});

test("rejects invalid versions, duplicate keys, and malformed semantics", () => {
  assert.throws(
    () => validateAthenaRightsIr({ ...document(), irVersion: 2 }),
    /version/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr(
        document([right("data.records.read"), right("data.records.read")])
      ),
    /duplicate/
  );
  assert.throws(
    () => validateAthenaRightsIr(document([right("data.records.read", { domain: "" })])),
    /domain/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr(
        document([right("data.records.read", { displayName: " " })])
      ),
    /displayName/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr(
        document([right("data.records.read", { riskLevel: "unknown" as never })])
      ),
    /riskLevel/
  );
  assert.throws(
    () =>
      validateAthenaRightsIr(
        document([right("data.records.read", { scopeKind: "tenant" as never })])
      ),
    /scopeKind/
  );
});

test("canonicalizes without mutation and is idempotent", () => {
  const value = document(
    [right("zeta.read"), right("alpha.read")],
    { provenance: ["storage", "catalog", "storage"] }
  );
  const original = structuredClone(value);
  const canonical = canonicalizeAthenaRightsIr(value);

  assert.deepEqual(value, original);
  assert.deepEqual(
    canonical.rights.map(({ key }) => key),
    ["alpha.read", "zeta.read"]
  );
  assert.deepEqual(canonical.metadata, { provenance: ["catalog", "storage"] });
  assert.deepEqual(
    canonicalizeAthenaRightsIr(canonical),
    canonical
  );
});

test("fingerprints every semantic field but excludes metadata", () => {
  const base = document();
  const baseFingerprint = fingerprintAthenaRightsIr(base);
  const semanticChanges: AthenaRightsIr[] = [
    document([right("data.records.list")]),
    document([right("data.records.read", { domain: "auth" })]),
    document([right("data.records.read", { displayName: "List records" })]),
    document([right("data.records.read", { description: "List records" })]),
    document([right("data.records.read", { scopeKind: "organization" })]),
    document([right("data.records.read", { riskLevel: "elevated" })]),
    document([right("data.records.read", { assignable: false })]),
  ];

  for (const changed of semanticChanges) {
    assert.notEqual(fingerprintAthenaRightsIr(changed), baseFingerprint);
  }
  assert.equal(
    fingerprintAthenaRightsIr(document(base.rights, { provenance: ["runtime"] })),
    baseFingerprint
  );
});

test("uses the existing branded Right key parser", () => {
  const key: AthenaRightKey = parseAthenaRightKey("data.records.read");
  assert.equal(key, "data.records.read");
  assert.throws(
    () =>
      validateAthenaRightsIr(
        document([right("data.records.read", { key: "data:records" as never })])
      ),
    /right key/
  );
});
