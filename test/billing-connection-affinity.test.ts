import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type BillingConnectionAffinity,
  configuredProvidersForBillingConnection,
  resolveBillingConnectionAffinity,
} from "../src/billing/subject/connection-affinity.ts";
import {
  createVerifiedBillingContact,
  type VerifiedBillingContact,
} from "../src/billing/subject/contact.ts";
import { FetchMollieSdk } from "./helpers/fetch-mollie-sdk.ts";

const BASE_INPUT = {
  environment: "test" as const,
  operation: "self.subscription.enroll" as const,
  ownerId: "app-a",
  ownerKind: "tenant" as const,
  provider: "mollie",
  subjectId: "user-1",
  subjectKind: "user",
};

function sqlFor(rowsByQuery: Record<string, Record<string, unknown>[][]>) {
  return {
    async query(text: string) {
      for (const [marker, rows] of Object.entries(rowsByQuery)) {
        if (text.includes(marker)) {
          return { rows };
        }
      }
      return { rows: [] };
    },
  };
}

test("connection affinity prefers the owned resource over active bindings and globals", async () => {
  const result = await resolveBillingConnectionAffinity({
    ...BASE_INPUT,
    ownedConnectionId: "owned-connection",
    sql: sqlFor({
      "WHERE id = $1::uuid": [
        {
          credential_reference: "providers.mollie:owned",
          environment: "test",
          id: "owned-connection",
          owner_id: "app-a",
          owner_kind: "tenant",
          provider: "mollie",
          status: "active",
        },
      ],
    }),
  });

  assert.deepEqual(result, {
    connectionId: "owned-connection",
    credentialReference: "providers.mollie:owned",
    environment: "test",
    provider: "mollie",
    source: "owned_resource",
  } satisfies BillingConnectionAffinity);
});

test("unusable ownedConnectionId does not fall through to eligible connections", async () => {
  await assert.rejects(
    () =>
      resolveBillingConnectionAffinity({
        ...BASE_INPUT,
        configuredProviders: {
          mollie: { sdk: FetchMollieSdk, testKey: "test_aff" },
        },
        ownedConnectionId: "owned-connection",
        sql: sqlFor({
          "WHERE id = $1::uuid": [
            {
              credential_reference: "providers.mollie:removed",
              environment: "test",
              id: "owned-connection",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
          "FROM billing.billing_subject_bindings": [],
          "WHERE deleted_at IS NULL": [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "connection-a",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
        }),
      }),
    (error: unknown) =>
      error instanceof Error &&
      "reason" in error &&
      error.reason === "provider_connection_missing",
  );
});

test("connection affinity uses one active subject binding before configured defaults", async () => {
  const result = await resolveBillingConnectionAffinity({
    ...BASE_INPUT,
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [
        {
          credential_reference: "providers.mollie:bound",
          environment: "test",
          id: "bound-connection",
          owner_id: "app-a",
          owner_kind: "tenant",
          provider: "mollie",
          status: "active",
        },
      ],
    }),
  });

  assert.equal(result.connectionId, "bound-connection");
  assert.equal(result.source, "subject_binding");
  assert.equal(result.credentialReference, "providers.mollie:bound");
});

test("connection affinity rejects multiple eligible connections instead of choosing the first", async () => {
  await assert.rejects(
    () =>
      resolveBillingConnectionAffinity({
        ...BASE_INPUT,
        sql: sqlFor({
          "FROM billing.billing_subject_bindings": [],
          "WHERE deleted_at IS NULL": [
            {
              credential_reference: "providers.mollie",
              environment: "test",
              id: "connection-a",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
            {
              credential_reference: "providers.mollie:eu",
              environment: "test",
              id: "connection-b",
              owner_id: "app-a",
              owner_kind: "tenant",
              provider: "mollie",
              status: "active",
            },
          ],
        }),
      }),
    (error: unknown) =>
      error instanceof Error &&
      "reason" in error &&
      error.reason === "provider_connection_ambiguous",
  );
});

test("connection affinity honors an explicit configured connection after subject lookup", async () => {
  const result = await resolveBillingConnectionAffinity({
    ...BASE_INPUT,
    explicitConnectionId: "configured-connection",
    sql: sqlFor({
      "FROM billing.billing_subject_bindings": [],
      "WHERE id = $1::uuid": [
        {
          credential_reference: "providers.mollie",
          environment: "test",
          id: "configured-connection",
          owner_id: "app-a",
          owner_kind: "tenant",
          provider: "mollie",
          status: "active",
        },
      ],
    }),
  });

  assert.equal(result.connectionId, "configured-connection");
  assert.equal(result.source, "configured_connection");
});

test("verified billing contact requires Auth verification provenance", () => {
  const verified: VerifiedBillingContact = createVerifiedBillingContact({
    email: "owner@example.test",
    source: "athena-auth",
    subjectId: "user-1",
    verifiedEmailObservedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.deepEqual(verified, {
    email: "owner@example.test",
    source: "athena-auth",
    subjectId: "user-1",
    verifiedEmailObservedAt: "2026-09-01T00:00:00.000Z",
  });
  assert.throws(
    () =>
      createVerifiedBillingContact({
        email: "unverified@example.test",
        source: "athena-auth",
        subjectId: "user-1",
        verifiedEmailObservedAt: null,
      }),
    /verified/i,
  );
});

test("connection affinity scopes provider credentials to the selected account", async () => {
  const affinity = await resolveBillingConnectionAffinity({
    ...BASE_INPUT,
    ownedConnectionId: "bound-connection",
    sql: sqlFor({
      "WHERE id = $1::uuid": [
        {
          credential_reference: "providers.mollie:bound",
          environment: "test",
          id: "bound-connection",
          owner_id: "app-a",
          owner_kind: "tenant",
          provider: "mollie",
          status: "active",
        },
      ],
    }),
  });
  const configured = {
    mollie: { sdk: FetchMollieSdk, testKey: "default-key" },
    mollieAccounts: {
      bound: { sdk: FetchMollieSdk, testKey: "bound-key" },
    },
  };

  const scoped = configuredProvidersForBillingConnection({
    affinity,
    configuredProviders: configured,
    operation: "self.subscription.enroll",
  });
  assert.equal(scoped.mollie?.testKey, "bound-key");
  assert.equal(scoped.mollieAccounts, undefined);
});

test("connection affinity rejects missing named provider account slots", () => {
  const configuredProviders = {
    mollie: { sdk: FetchMollieSdk, testKey: "default-mollie-key" },
    stripe: { testKey: "default-stripe-key" },
  };
  for (const [provider, credentialReference] of [
    ["mollie", "providers.mollie:removed"],
    ["stripe", "providers.stripe:removed"],
  ] as const) {
    assert.throws(
      () =>
        configuredProvidersForBillingConnection({
          affinity: {
            connectionId: `${provider}-connection`,
            credentialReference,
            environment: "test",
            provider,
            source: "owned_resource",
          },
          configuredProviders,
          operation: "self.subscription.change",
        }),
      (error: unknown) =>
        error instanceof Error &&
        "reason" in error &&
        error.reason === "provider_connection_missing",
    );
  }
});

test("plan changes derive affinity from the owned subscription connection", () => {
  const source = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "src",
      "billing",
      "runtime",
      "self",
      "change.ts",
    ),
    "utf8",
  );
  assert.match(source, /ownedConnectionId: ownedVersion\.connectionId/);
  assert.doesNotMatch(source, /resolveBillingConnectionForOperation/);
});
