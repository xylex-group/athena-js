import assert from "node:assert/strict";
import test from "node:test";

import {
  ATHENA_CAPABILITIES_IR_KIND,
  ATHENA_CAPABILITIES_IR_VERSION,
  canonicalizeAthenaCapabilitiesIr,
  fingerprintAthenaCapabilitiesIr,
  parseAthenaCapabilityKey,
  validateAthenaCapabilitiesIr,
} from "../../src/capabilities/index.ts";
import {
  athenaCapabilityKeyString,
  tryParseAthenaCapabilityKey,
} from "../../src/capabilities/key.ts";
import {
  resolveAthenaCapabilities,
  type AthenaCapabilityContribution,
} from "../../src/capabilities/resolver.ts";
import { queryCapabilitiesToContributions } from "../../src/query/engine/capability-contributions.ts";
import { transactionCapabilitiesToContributions } from "../../src/db/transaction/capability-contributions.ts";
import { chatCapabilitiesToContributions } from "../../src/chat/capability-contributions.ts";
import {
  billingCapabilitiesToContributions,
  billingOperationCapabilityKey,
} from "../../src/billing/runtime/capability-contributions.ts";
import { projectAthenaCapabilitiesToDevtools } from "../../src/devtools/produce/capabilities.ts";
import { projectCapabilitiesToDiscovery } from "../../src/runtime/data/capabilities-projection.ts";
import type { AthenaRuntimeDiscoveryCapabilities } from "../../src/gateway/discovery-types.ts";
import { authCapabilitiesToContributions } from "../../src/auth/capability-contributions.ts";
import { projectAthenaClientCapabilities } from "../../src/capabilities/client-projection.ts";
import type { AthenaClientCapabilities } from "../../src/cloudflare/types.ts";
import { resolveAthenaOperationReadiness } from "../../src/runtime/readiness/index.ts";
import {
  authorizationAffordancesFromRights,
  capabilitiesFromRights,
} from "../../src/runtime/authorization/capabilities.ts";
import { storageCapabilitiesToContributions } from "../../src/storage/runtime/capability-contributions.ts";
import {
  disabledCapabilityContribution,
  unsupportedCapabilityContribution,
} from "../../src/capabilities/contribution.ts";
import {
  D1_QUERY_CAPABILITIES,
  POSTGRES_QUERY_CAPABILITIES,
  GATEWAY_QUERY_CAPABILITIES,
} from "../../src/query/engine/capabilities.ts";
import { resolveAthenaClientCapabilitiesIr } from "../../src/capabilities/assembly.ts";
import { getAthenaClientInternals } from "../../src/runtime/client-internals.ts";
import { createClient } from "../../src/v3-client.ts";
import { produceAthenaDevtoolsSnapshot } from "../../src/devtools/produce/index.ts";
import { serializeAthenaRuntimeDiscoveryDocument } from "../../src/runtime/data/discovery-document.ts";
import { createAthenaServerRuntime } from "../../src/runtime/data/runtime.ts";

function entry(overrides: Record<string, unknown> = {}) {
  return {
    key: "data.operation.fetch",
    domain: "data",
    kind: "operation",
    implementation: "native",
    status: "available",
    maturity: "stable",
    sources: [{ kind: "runtime", source: "test" }],
    ...overrides,
  };
}

function document(overrides: Record<string, unknown> = {}) {
  return {
    kind: ATHENA_CAPABILITIES_IR_KIND,
    irVersion: ATHENA_CAPABILITIES_IR_VERSION,
    capabilities: [entry()],
    metadata: {},
    ...overrides,
  };
}

test("ACT-CAP-001: capability keys are branded, parsed, and stringified", () => {
  const key = parseAthenaCapabilityKey("data.query.jsonb-containment");
  assert.equal(athenaCapabilityKeyString(key), "data.query.jsonb-containment");
  assert.equal(tryParseAthenaCapabilityKey("data.query.valid"), "data.query.valid");
  assert.equal(tryParseAthenaCapabilityKey("Data.query.invalid"), undefined);
  assert.throws(() => parseAthenaCapabilityKey("data..invalid"));
});

test("ACT-CAP-002: canonicalization is deterministic and idempotent", () => {
  const input = document({
    capabilities: [
      entry({
        key: "data.operation.update",
        sources: [
          { kind: "provider", source: "postgres" },
          { kind: "provider", source: "postgres" },
        ],
      }),
      entry(),
    ],
    metadata: { generatedAt: "2026-09-03T00:00:00.000Z" },
  });
  const once = canonicalizeAthenaCapabilitiesIr(input);
  assert.deepEqual(
    once.capabilities.map((capability) => capability.key),
    ["data.operation.fetch", "data.operation.update"]
  );
  assert.equal(once.capabilities[1]?.sources.length, 1);
  assert.deepEqual(canonicalizeAthenaCapabilitiesIr(once), once);
});

test("ACT-CAP-003: metadata does not change the semantic fingerprint", () => {
  const first = fingerprintAthenaCapabilitiesIr(document());
  const second = fingerprintAthenaCapabilitiesIr(
    document({
      metadata: {
        generatedAt: "2026-09-03T00:00:00.000Z",
        provenance: ["runtime-plan"],
      },
    })
  );
  assert.equal(first, second);
});

test("ACT-CAP-004: semantic capability changes change the fingerprint", () => {
  const first = fingerprintAthenaCapabilitiesIr(document());
  const second = fingerprintAthenaCapabilitiesIr(
    document({ capabilities: [entry({ status: "degraded" })] })
  );
  assert.notEqual(first, second);
});

test("ACT-CAP-005: validation rejects invalid states, fields, and domain keys", () => {
  assert.doesNotThrow(() => validateAthenaCapabilitiesIr(document()));
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({ capabilities: [entry({ implementation: "unsupported" })] })
    )
  );
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({ capabilities: [entry({ key: "auth.session.list" })] })
    )
  );
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({ capabilities: [entry({ details: { secret: "no" } })] })
    )
  );
});

test("ACT-CAP-006: conflicting contributions fail closed", () => {
  const base: AthenaCapabilityContribution = {
    key: parseAthenaCapabilityKey("data.operation.fetch"),
    domain: "data",
    kind: "operation",
    implementation: "native",
    status: "available",
    maturity: "stable",
    source: { kind: "runtime", source: "one" },
  };
  assert.deepEqual(
    resolveAthenaCapabilities([base, { ...base, source: { kind: "catalog", source: "two" } }])
      .capabilities[0]?.sources,
    [
      { kind: "catalog", source: "two" },
      { kind: "runtime", source: "one" },
    ]
  );
  assert.throws(() =>
    resolveAthenaCapabilities([
      base,
      { ...base, status: "unavailable", source: { kind: "provider", source: "two" } },
    ])
  );
});

test("ACT-CAP-014: canonical entries carry no principal, rights, or policy state", () => {
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({
        capabilities: [
          entry({
            principal: "user-1",
            rights: ["billing.payments.write"],
          }),
        ],
      })
    )
  );
});

test("ACT-CAP-007: query matrices produce explicit canonical facts", () => {
  const contributions = queryCapabilitiesToContributions({
    backend: "postgresql",
    ilike: true,
    jsonbContainment: false,
    manyToManyRelations: true,
    nestedOrdering: true,
    nestedPagination: true,
    nestedRelations: true,
    nullsOrdering: false,
    relationFirstSelection: true,
    relationalPredicates: true,
  });
  const resolved = resolveAthenaCapabilities(contributions);
  assert.equal(
    resolved.capabilities.find((capability) => capability.key === "data.query.ilike")
      ?.status,
    "available"
  );
  assert.equal(
    resolved.capabilities.find(
      (capability) => capability.key === "data.query.jsonb-containment"
    )?.status,
    "unavailable"
  );
});

test("ACT-CAP-008: transaction and chat matrices produce stable keys", () => {
  const transaction = transactionCapabilitiesToContributions({
    atomic: true,
    backend: "postgres-direct",
    deferrable: true,
    interactive: true,
    isolationLevels: ["serializable"],
    readOnly: true,
    savepoints: true,
  });
  const chat = chatCapabilitiesToContributions({
    transport: "remote",
    realtime: {
      crossProcess: true,
      messageDeletes: true,
      messages: true,
      messageUpdates: true,
      presence: true,
      reactions: true,
      replayPersisted: true,
      resumable: true,
      typing: true,
      websocket: true,
    },
  });
  const keys = resolveAthenaCapabilities([...transaction, ...chat]).capabilities.map(
    (capability) => capability.key
  );
  assert.equal(keys.includes("data.transaction.savepoints"), true);
  assert.equal(keys.includes("chat.realtime.websocket"), true);
});

test("ACT-CAP-013: Billing operation mapping is explicit and stable", () => {
  assert.equal(
    billingOperationCapabilityKey("self.subscription.change"),
    "billing.operation.self.subscription.change"
  );
  assert.equal(
    billingOperationCapabilityKey("payments.create"),
    "billing.operation.payments.create"
  );
});

test("ACT-CAP-015: DevTools projects canonical entries and fingerprint", () => {
  const ir = resolveAthenaCapabilities([
    {
      key: parseAthenaCapabilityKey("data.operation.fetch"),
      domain: "data",
      kind: "operation",
      implementation: "native",
      status: "available",
      maturity: "stable",
      source: { kind: "runtime", source: "test" },
    },
  ]);
  const inspector = projectAthenaCapabilitiesToDevtools(ir);
  assert.equal(inspector.fingerprint, fingerprintAthenaCapabilitiesIr(ir));
  assert.deepEqual(inspector.summary, {
    available: 1,
    unavailable: 0,
    degraded: 0,
    unknown: 0,
  });
  assert.equal(inspector.entries[0]?.reason, null);
});

test("ACT-CAP-009: Discovery projects known canonical facts without collapsing unknown", () => {
  const base: AthenaRuntimeDiscoveryCapabilities = {
    auth: false,
    delete: true,
    fetch: true,
    insert: true,
    models: "strict",
    nestedRelations: true,
    policy: false,
    rawSql: false,
    rpc: false,
    update: true,
  };
  const ir = resolveAthenaCapabilities([
    {
      key: parseAthenaCapabilityKey("data.operation.fetch"),
      domain: "data",
      kind: "operation",
      implementation: "native",
      status: "unknown",
      maturity: "stable",
      source: { kind: "runtime", source: "test" },
    },
    {
      key: parseAthenaCapabilityKey("data.operation.rpc"),
      domain: "data",
      kind: "operation",
      implementation: "unsupported",
      status: "unavailable",
      maturity: "disabled",
      source: { kind: "runtime", source: "test" },
    },
  ]);
  const projected = projectCapabilitiesToDiscovery(ir, base);
  assert.equal(projected.fetch, true);
  assert.equal(projected.rpc, false);
});

test("ACT-CAP-012: Auth unknown status becomes unknown runtime support", () => {
  const contributions = authCapabilitiesToContributions({
    source: "http",
    status: "unknown",
  });
  assert.equal(
    resolveAthenaCapabilities(contributions).capabilities.every(
      (capability) => capability.status === "unknown"
    ),
    true
  );
});

test("ACT-CAP-010: client capability bags are projections of canonical entries", () => {
  const base: AthenaClientCapabilities = {
    auth: { remote: false },
    db: {
      engine: "postgresql",
      layers: {
        findManyAst: true,
        flatCrud: true,
        query: true,
        relations: true,
        rpc: true,
      },
      local: true,
      transactions: {
        atomic: true,
        backend: "postgres-direct",
        deferrable: true,
        interactive: true,
        isolationLevels: ["serializable"],
        readOnly: true,
        savepoints: true,
      },
    },
    mode: "gateway",
    storage: { backups: true, catalogs: true, local: true, objects: true },
  };
  const ir = resolveAthenaCapabilities([
    {
      key: parseAthenaCapabilityKey("data.operation.rpc"),
      domain: "data",
      kind: "operation",
      implementation: "unsupported",
      status: "unavailable",
      maturity: "disabled",
      source: { kind: "runtime", source: "test" },
    },
    {
      key: parseAthenaCapabilityKey("storage.object.get"),
      domain: "storage",
      kind: "operation",
      implementation: "native",
      status: "available",
      maturity: "stable",
      source: { kind: "runtime", source: "test" },
    },
  ]);
  const projected = projectAthenaClientCapabilities(ir, base);
  assert.equal(projected.db.layers.rpc, false);
  assert.equal(projected.storage.objects, true);
});

test("ACT-CAP-014: rights-derived values are authorization affordances", () => {
  const rights = [
    "authorization.platform.write",
  ] as Parameters<typeof capabilitiesFromRights>[0];
  assert.deepEqual(
    authorizationAffordancesFromRights(rights),
    capabilitiesFromRights(rights)
  );
});

test("ACT-CAP-010: storage runtime facts use canonical object and catalog keys", () => {
  const ir = resolveAthenaCapabilities(
    storageCapabilitiesToContributions({
      backups: false,
      catalogs: true,
      objects: true,
      source: "s3",
    })
  );
  assert.equal(
    ir.capabilities.find((capability) => capability.key === "storage.catalog.read")
      ?.status,
    "available"
  );
  assert.equal(
    ir.capabilities.find((capability) => capability.key === "storage.backup.create")
      ?.status,
    "unavailable"
  );
});

test("ACT-CAP-013: readiness composes support and authorization outside the IR", () => {
  const capability = resolveAthenaCapabilities([
    {
      key: parseAthenaCapabilityKey("billing.operation.payments.create"),
      domain: "billing",
      kind: "operation",
      implementation: "native",
      status: "available",
      maturity: "stable",
      source: { kind: "provider", source: "mollie:test" },
    },
  ]).capabilities[0];
  assert.ok(capability);
  assert.equal(
    resolveAthenaOperationReadiness({
      capability,
      authorization: "allowed",
      policy: "not-applicable",
    }).executable,
    true
  );
  assert.equal(
    resolveAthenaOperationReadiness({
      capability,
      authorization: "denied",
      policy: "not-applicable",
    }).executable,
    false
  );
});

test("ACT-CAP-013: Billing snapshots contribute support, not authorization", () => {
  const contributions = billingCapabilitiesToContributions({
    connected: true,
    operations: {
      "payments.create": { available: true },
    },
    ports: {
      customers: false,
      invoices: false,
      paymentLinks: false,
      payments: true,
      refunds: false,
      subscriptions: false,
      webhooks: false,
      products: false,
      prices: false,
      relations: false,
      checkout: false,
      self: false,
    },
    provider: "mollie",
    runtime: "local",
    target: { kind: "configured", provider: "mollie" },
  });
  assert.equal(contributions[0]?.key, "billing.operation.payments.create");
  assert.equal("authorized" in contributions[0], false);
});

test("ACT-CAP-005: unsupported and disabled contributions retain different semantics", () => {
  const source = { kind: "catalog" as const, source: "test" };
  const unsupported = unsupportedCapabilityContribution(
    { key: "data.query.ilike", domain: "data", kind: "feature" },
    source
  );
  const disabled = disabledCapabilityContribution(
    { key: "auth.passkey.registration", domain: "auth", kind: "feature" },
    source
  );
  assert.deepEqual(
    {
      implementation: unsupported.implementation,
      maturity: unsupported.maturity,
      reason: unsupported.reason?.code,
    },
    {
      implementation: "unsupported",
      maturity: "stable",
      reason: "provider.unsupported",
    }
  );
  assert.deepEqual(
    {
      implementation: disabled.implementation,
      maturity: disabled.maturity,
      reason: disabled.reason?.code,
    },
    {
      implementation: "native",
      maturity: "disabled",
      reason: "feature.disabled",
    }
  );
});

test("ACT-CAP-005: nested domain reason codes validate consistently", () => {
  assert.doesNotThrow(() =>
    validateAthenaCapabilitiesIr(
      document({
        capabilities: [
          entry({
            status: "unavailable",
            reason: { code: "billing.provider.operation-unsupported" },
          }),
        ],
      })
    )
  );
});

test("ACT-CAP-005: opaque metadata and source values are rejected", () => {
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({ metadata: { extensions: { secret: "value" } } })
    )
  );
  assert.throws(() =>
    validateAthenaCapabilitiesIr(
      document({
        capabilities: [
          entry({
            sources: [{ kind: "provider", source: "https://secret.example/key" }],
          }),
        ],
      })
    )
  );
});

test("ACT-CAP-005: the implementation/status state algebra is exhaustive", () => {
  const implementations = [
    "native",
    "proxied",
    "emulated",
    "unsupported",
    "unknown",
  ] as const;
  const statuses = ["available", "unavailable", "degraded", "unknown"] as const;
  for (const implementation of implementations) {
    for (const status of statuses) {
      const valid =
        implementation === "unknown"
          ? status === "unknown"
          : implementation === "unsupported"
            ? status === "unavailable" || status === "unknown"
            : true;
      const check = () =>
        validateAthenaCapabilitiesIr(
          document({ capabilities: [entry({ implementation, status })] })
        );
      if (valid) {
        assert.doesNotThrow(check);
      } else {
        assert.throws(check);
      }
    }
  }
  const invalid: Array<[string, string]> = [
    ["unsupported", "degraded"],
    ["unsupported", "available"],
    ["unknown", "unavailable"],
    ["unknown", "degraded"],
    ["unknown", "available"],
  ];
  for (const [implementation, status] of invalid) {
    assert.throws(() =>
      validateAthenaCapabilitiesIr(
        document({ capabilities: [entry({ implementation, status })] })
      )
    );
  }
  for (const status of ["unavailable", "unknown"] as const) {
    assert.doesNotThrow(() =>
      validateAthenaCapabilitiesIr(
        document({ capabilities: [entry({ implementation: "unsupported", status })] })
      )
    );
  }
});

test("ACT-CAP-013: Billing workflow safety does not become capability maturity", () => {
  const contribution = billingCapabilitiesToContributions({
    connected: true,
    operations: {
      "payments.create": { available: true, safety: "disabled" },
    },
    ports: {
      customers: false,
      invoices: false,
      paymentLinks: false,
      payments: true,
      refunds: false,
      subscriptions: false,
      webhooks: false,
      products: false,
      prices: false,
      relations: false,
      checkout: false,
      self: false,
    },
    provider: "mollie",
    runtime: "local",
    target: { kind: "configured", provider: "mollie" },
  })[0];
  assert.equal(contribution?.maturity, "stable");
});

test("ACT-CAP-019: producer false facts retain their cause", () => {
  const storage = storageCapabilitiesToContributions({
    backups: false,
    catalogs: false,
    objects: false,
    source: "none",
  });
  assert.equal(storage[0]?.implementation, "native");
  assert.equal(storage[0]?.status, "unavailable");
  assert.equal(storage[0]?.reason?.code, "provider.unconfigured");

  const query = queryCapabilitiesToContributions({
    backend: "d1",
    ilike: false,
    jsonbContainment: false,
    manyToManyRelations: false,
    nestedOrdering: false,
    nestedPagination: false,
    nestedRelations: false,
    nullsOrdering: false,
    relationFirstSelection: false,
    relationalPredicates: false,
  });
  assert.equal(query[0]?.implementation, "unsupported");
  assert.equal(query[0]?.reason?.code, "provider.unsupported");
});

test("ACT-CAP-007: D1 contribution facts come from D1's explicit query matrix", () => {
  const ir = resolveAthenaClientCapabilitiesIr({
    base: {
      auth: { remote: false },
      db: {
        engine: "cloudflare-d1",
        layers: {
          findManyAst: true,
          flatCrud: true,
          query: true,
          relations: true,
          rpc: false,
        },
        local: true,
        transactions: {
          atomic: true,
          backend: "d1-batch",
          deferrable: false,
          interactive: false,
          isolationLevels: [],
          readOnly: false,
          savepoints: false,
        },
      },
      mode: "cloudflare-edge",
      storage: { backups: false, catalogs: false, local: false, objects: false },
    },
    query: D1_QUERY_CAPABILITIES,
  });
  for (const key of [
    "data.query.ilike",
    "data.query.jsonb-containment",
    "data.query.nulls-ordering",
  ]) {
    assert.equal(
      ir.capabilities.find((capability) => capability.key === key)?.status,
      "unavailable"
    );
  }
  assert.equal(POSTGRES_QUERY_CAPABILITIES.ilike, true);
  assert.equal(GATEWAY_QUERY_CAPABILITIES.ilike, true);
});

test("ACT-CAP-018: materialized runtime stores one IR used by DevTools", async () => {
  const client = createClient({
    url: "https://example.test",
    key: "test-key",
    auth: false,
  });

  test("ACT-CAP-018: runtime ingress canonicalizes supplied capability documents", () => {
    assert.throws(() =>
      createAthenaServerRuntime({
        databaseUrl: "postgres://example.invalid/athena",
        security: { mode: "authenticated" },
        capabilitiesIr: document({
          capabilities: [entry({ implementation: "unsupported", status: "degraded" })],
        }) as never,
      })
    );
  });

  test("ACT-CAP-012: Auth capability updates refresh the runtime IR", async () => {
    const client = createClient({
      url: "https://data.example",
      key: "test-key",
      auth: { url: "https://auth.example" },
    });
    const internals = getAthenaClientInternals(client);
    assert.ok(internals?.capabilitiesIr);
    assert.equal(
      internals.capabilitiesIr.capabilities.find(
        (capability) => capability.key === "auth.organization.manage"
      )?.status,
      "unknown"
    );
    client.auth.capabilities.set({
      organizations: true,
      source: "http",
      status: "known",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(
      internals.capabilitiesIr.capabilities.find(
        (capability) => capability.key === "auth.organization.manage"
      )?.status,
      "available"
    );
    assert.equal(typeof internals.capabilitiesFingerprint, "string");
    await client.close();
  });
  const internals = getAthenaClientInternals(client);
  assert.ok(internals?.capabilitiesIr);
  const snapshot = await produceAthenaDevtoolsSnapshot(
    {},
    { internals }
  );
  assert.equal(
    snapshot.capabilities.fingerprint,
    internals.capabilitiesFingerprint
  );
  await client.close();
});

test("ACT-CAP-009: runtime Discovery serialization consumes the stored IR", () => {
  const ir = resolveAthenaClientCapabilitiesIr({
    base: {
      auth: { remote: false },
      db: {
        engine: "postgresql",
        layers: {
          findManyAst: true,
          flatCrud: true,
          query: true,
          relations: true,
          rpc: false,
        },
        local: true,
        transactions: {
          atomic: true,
          backend: "postgres-direct",
          deferrable: true,
          interactive: true,
          isolationLevels: ["serializable"],
          readOnly: true,
          savepoints: true,
        },
      },
      mode: "gateway",
      storage: { backups: false, catalogs: false, local: false, objects: false },
    },
    query: {
      ...POSTGRES_QUERY_CAPABILITIES,
      ilike: false,
      jsonbContainment: false,
      nullsOrdering: false,
    },
  });
  const document = serializeAthenaRuntimeDiscoveryDocument({
    capabilities: {
      auth: false,
      modelEnforcement: "strict",
      nestedRelations: true,
      policies: false,
      rawSql: false,
      rpc: true,
      security: "authenticated",
      transport: "postgres-direct",
    },
    capabilitiesIr: ir,
  });
  assert.equal(document.capabilities.fetch, true);
  assert.equal(document.capabilities.rpc, false);
});
