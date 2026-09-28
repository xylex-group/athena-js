import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../src/auth/contract/index.ts";
import { passwordHashNeedsRehash } from "../src/auth/local/password.ts";
import { createAthenaAuthRuntime } from "../src/auth/local/runtime.ts";
import { PROCESS_BILLING_INVOCATION } from "../src/billing/runtime/invocation-authority.ts";
import { deriveConfiguredProviderAccountReference } from "../src/billing/runtime/local/connections/identity.ts";
import {
  billingConnectionHasConfiguredCredential,
  billingConnectionMatchesProcessTestMode,
  eligibleBillingConnectionsForProcess,
  pickSoleEligibleBillingConnection,
} from "../src/billing/runtime/local/providers/connection-binding.ts";
import { createBillingProviderRegistry } from "../src/billing/runtime/local/providers/create-registry.ts";
import { createLocalBillingRuntime } from "../src/billing/runtime/local/runtime.ts";
import {
  configuredBillingConnectionInitKey,
  configuredBillingConnectionIntents,
  materializeConfiguredBillingConnections,
  singleFlightConfiguredBillingConnectionMaterialize,
  supersedeOtherEnvironmentBillingConnections,
} from "../src/billing/runtime/materialize-configured-connections.ts";

const WEBHOOK_INGRESS_TOKEN = "whtok_aaaaaaaaaaaaaa";

function materializeQueryRecorder(
  statements: { sql: string; params: readonly unknown[] }[],
  id = "conn_1"
) {
  return {
    async query(sql: string, params?: readonly unknown[]) {
      statements.push({ params: params ?? [], sql });
      if (sql.includes("RETURNING")) {
        return {
          rows: [{ id, webhook_ingress_token: WEBHOOK_INGRESS_TOKEN }],
        };
      }
      return { rows: [] };
    },
  };
}

test("configured intents use app id, provider, and testMode environment", () => {
  const intents = configuredBillingConnectionIntents({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        apiMode: "test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    testMode: true,
  });
  assert.equal(intents.length, 1);
  assert.deepEqual(intents[0], {
    accountReference: "next-minimal-mollie-test",
    credentialKind: "advanced_access_token",
    credentialReference: "providers.mollie",
    environment: "test",
    identity: {
      credentialReference: "providers.mollie",
      environment: "test",
      provider: "mollie",
    },
    provider: "mollie",
    providerAccountId: null,
  });
});

test("named Mollie accounts get distinct credential_reference slots", () => {
  const intents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      mollieAccounts: {
        org: declaredMollie(),
      },
    },
    testMode: false,
  });
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.credentialReference, "providers.mollie:org");
  assert.equal(intents[0]?.accountReference, "app-mollie-org-live");
  assert.equal(intents[0]?.environment, "live");
  assert.deepEqual(intents[0]?.identity, {
    credentialReference: "providers.mollie:org",
    environment: "live",
    provider: "mollie",
    scopeKey: "org",
  });
});

test("materialize upserts each configured connection and returns ids", async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  const result = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    sql: materializeQueryRecorder(statements),
    testMode: true,
  });
  assert.equal(statements.length, 2);
  assert.match(statements[0]?.sql ?? "", /HAVING COUNT\(\*\) > 1/);
  assert.match(
    statements[1]?.sql ?? "",
    /ON CONFLICT \(owner_kind, owner_id, provider, environment, credential_reference\)/
  );
  assert.match(
    statements[1]?.sql ?? "",
    /\$6,\s*\$7,\s*\$8/
  );
  assert.match(
    statements[1]?.sql ?? "",
    /provider_account_id = COALESCE\([\s\S]*EXCLUDED\.provider_account_id[\s\S]*billing\.billing_provider_connections\.provider_account_id/
  );
  assert.match(
    statements[1]?.sql ?? "",
    /webhookIngressToken', \$9/
  );
  assert.equal(statements[1]?.params.length, 9);
  assert.equal(statements[1]?.params[0], "next-minimal");
  assert.equal(statements[1]?.params[1], "mollie");
  assert.equal(statements[1]?.params[2], "test");
  assert.deepEqual(result.connections, [
    {
      accountReference: "next-minimal-mollie-test",
      credentialReference: "providers.mollie",
      id: "conn_1",
      provider: "mollie",
      webhookIngressToken: WEBHOOK_INGRESS_TOKEN,
    },
  ]);
});

test("environment supersession is deferred until webhook activation", async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  await supersedeOtherEnvironmentBillingConnections({
    applicationId: "next-minimal",
    credentialReference: "providers.mollie",
    environment: "live",
    id: "conn_live",
    provider: "mollie",
    sql: materializeQueryRecorder(statements),
  });
  assert.equal(statements.length, 1);
  const sql = statements[0]?.sql ?? "";
  const params = statements[0]?.params ?? [];
  assert.match(sql, /status = 'disabled'/);
  assert.match(sql, /'supersededByEnvironment',\s*\$1::text/);
  assert.match(sql, /'supersededByCredentialReference',\s*\$2::text/);
  assert.equal(params[0], "live");
  assert.equal(params[1], "providers.mollie");
  assert.equal(params[2], "next-minimal");
});

test("materialization returns callable tokenized webhook URLs", async () => {
  const result = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    publicBaseUrl: "https://hooks.example/",
    sql: materializeQueryRecorder([]),
    testMode: true,
  });
  assert.deepEqual(result.connections[0], {
    accountReference: "next-minimal-mollie-test",
    classicWebhookUrl:
      "https://hooks.example/api/athena/billing/webhook/mollie/classic/whtok_aaaaaaaaaaaaaa",
    credentialReference: "providers.mollie",
    eventsWebhookUrl:
      "https://hooks.example/api/athena/billing/webhook/mollie/events/whtok_aaaaaaaaaaaaaa",
    id: "conn_1",
    provider: "mollie",
    webhookIngressToken: WEBHOOK_INGRESS_TOKEN,
  });
});

test("materialization rejects a malformed persisted webhook binding token", async () => {
  await assert.rejects(
    () =>
      materializeConfiguredBillingConnections({
        applicationId: "next-minimal",
        configuredProviders: {
          mollie: declaredMollie(),
        },
        sql: {
          async query(sql) {
            if (sql.includes("RETURNING")) {
              return {
                rows: [{ id: "conn_1", webhook_ingress_token: "malformed" }],
              };
            }
            return { rows: [] };
          },
        },
        testMode: true,
      }),
    /invalid webhook ingress token/
  );
});

test("account reference is deterministic and independent of credential material", () => {
  assert.equal(
    deriveConfiguredProviderAccountReference({
      applicationId: "next-minimal",
      environment: "test",
      provider: "mollie",
      scope: "organization",
    }),
    "next-minimal-mollie-test"
  );
  assert.equal(
    deriveConfiguredProviderAccountReference({
      applicationId: "next-minimal",
      environment: "live",
      provider: "mollie",
    }),
    "next-minimal-mollie-live"
  );
});

test("no configured providers writes nothing", async () => {
  let queries = 0;
  const result = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {},
    sql: {
      async query() {
        queries += 1;
        return { rows: [] };
      },
    },
    testMode: true,
  });
  assert.equal(queries, 0);
  assert.deepEqual(result.connections, []);
});

test("second materialize reuses the same connection id", async () => {
  const sql = materializeQueryRecorder([], "conn_stable");
  const first = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    sql,
    testMode: true,
  });
  const second = await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        credentialKind: "organization_access_token",
        profileId: "pfl_rotated",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
        testToken: "access_rotated",
      },
    },
    sql,
    testMode: true,
  });
  assert.equal(first.connections[0]?.id, "conn_stable");
  assert.equal(second.connections[0]?.id, "conn_stable");
  assert.equal(
    first.connections[0]?.accountReference,
    second.connections[0]?.accountReference
  );
});

test("test vs live environments are distinct identities", () => {
  const testIntents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    testMode: true,
  });
  const liveIntents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      mollie: {
        accessToken: "access_live",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    testMode: false,
  });
  assert.equal(testIntents[0]?.accountReference, "app-mollie-test");
  assert.equal(liveIntents[0]?.accountReference, "app-mollie-live");
  assert.equal(testIntents[0]?.credentialReference, "providers.mollie");
  assert.equal(liveIntents[0]?.credentialReference, "providers.mollie-live");
});

test("omitted billing.testMode materializes the test environment slot", () => {
  const intents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
  });
  assert.equal(intents[0]?.environment, "test");
  assert.equal(intents[0]?.credentialReference, "providers.mollie");
  assert.equal(intents[0]?.identity.environment, "test");
});

test("upsert SQL reconciles config-owned fields and never binds secrets", async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  await materializeConfiguredBillingConnections({
    applicationId: "next-minimal",
    configuredProviders: {
      mollie: {
        accessToken: "access_secret_value",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    sql: materializeQueryRecorder(statements),
    testMode: true,
  });
  assert.match(statements[1]?.sql ?? "", /managedBy/);
  assert.match(
    statements[1]?.sql ?? "",
    /credential_kind = EXCLUDED.credential_kind/
  );
  assert.match(statements[1]?.sql ?? "", /mode = EXCLUDED.mode/);
  assert.equal(
    JSON.stringify(statements[1]?.params).includes("access_secret_value"),
    false
  );
  assert.equal(
    (statements[1]?.sql ?? "").includes("access_secret_value"),
    false
  );
});

test("provider filter materializes only Mollie", async () => {
  const statements: { sql: string; params: readonly unknown[] }[] = [];
  await materializeConfiguredBillingConnections({
    applicationId: "app",
    configuredProviders: {
      mollie: {
        accessToken: "access_test",
        credentialKind: "advanced_access_token",
        sdk: class {
          customers = {};
          paymentLinks = {};
          payments = {};
          refunds = {};
          subscriptions = {};
        },
      },
    },
    provider: "mollie",
    sql: materializeQueryRecorder(statements),
    testMode: true,
  });
  assert.equal(statements.length, 2);
});

test("DB unavailable fails the materializer", async () => {
  await assert.rejects(
    () =>
      materializeConfiguredBillingConnections({
        applicationId: "next-minimal",
        configuredProviders: {
          mollie: {
            accessToken: "access_test",
            credentialKind: "advanced_access_token",
            sdk: class {
              customers = {};
              paymentLinks = {};
              payments = {};
              refunds = {};
              subscriptions = {};
            },
          },
        },
        sql: {
          async query() {
            throw new Error("ECONNREFUSED");
          },
        },
        testMode: true,
      }),
    /ECONNREFUSED/
  );
});

test("stripe-only config produces a generic connection intent", () => {
  const intents = configuredBillingConnectionIntents({
    applicationId: "app",
    configuredProviders: {
      stripe: { testKey: "sk_test_x" },
    },
    testMode: true,
  });
  assert.equal(intents.length, 1);
  assert.equal(intents[0]?.provider, "stripe");
});

test("live-only Mollie config does not satisfy a test-mode connection", () => {
  const sdk = class {
    customers = {};
    paymentLinks = {};
    payments = {};
    refunds = {};
    subscriptions = {};
  };
  const configuredProviders = {
    mollie: {
      accessToken: "access_live",
      apiMode: "live" as const,
      credentialKind: "advanced_access_token" as const,
      sdk,
    },
  };
  assert.equal(
    billingConnectionHasConfiguredCredential({
      configuredProviders,
      connection: {
        credentialReference: "providers.mollie",
        provider: "mollie",
        testMode: false,
      },
    }),
    true
  );
  assert.equal(
    billingConnectionHasConfiguredCredential({
      configuredProviders,
      connection: {
        credentialReference: "providers.mollie",
        provider: "mollie",
        testMode: true,
      },
    }),
    false
  );
});

test("process live billing.testMode does not match leftover test connections", () => {
  assert.equal(billingConnectionMatchesProcessTestMode(true, false), false);
  assert.equal(billingConnectionMatchesProcessTestMode(false, false), true);
  assert.equal(billingConnectionMatchesProcessTestMode(true, true), true);
  assert.equal(billingConnectionMatchesProcessTestMode(true, undefined), true);
});

test("classic webhook refetch ignores leftover connections from the other environment", () => {
  const sdk = class {
    customers = {};
    paymentLinks = {};
    payments = {};
    refunds = {};
    subscriptions = {};
  };
  const configuredProviders = {
    mollie: {
      accessToken: "access_test",
      apiMode: "test" as const,
      credentialKind: "advanced_access_token" as const,
      sdk,
    },
  };
  const leftoverLive = {
    credentialReference: "providers.mollie",
    provider: "mollie",
    testMode: false,
  };
  const processTest = {
    credentialReference: "providers.mollie",
    provider: "mollie",
    testMode: true,
  };
  const eligible = eligibleBillingConnectionsForProcess({
    configuredProviders,
    connections: [leftoverLive, processTest],
    processTestMode: true,
  });
  assert.deepEqual(eligible, [processTest]);
});

test("classic webhook refetch prefers the default providers.mollie slot", () => {
  const named = { credentialReference: "providers.mollie:org" };
  const defaults = { credentialReference: "providers.mollie" };
  assert.equal(pickSoleEligibleBillingConnection([named, defaults]), defaults);
  assert.equal(pickSoleEligibleBillingConnection([defaults, named]), defaults);
  assert.equal(
    pickSoleEligibleBillingConnection([
      named,
      { credentialReference: "providers.mollie:other" },
    ]),
    undefined
  );
});

test("embedded billing 0018 makes provider_account_id nullable with nonempty check", () => {
  const sql = readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/migrations/embedded-billing/sql/0018_billing_provider_account_id_nullable.sql"
    ),
    "utf8"
  );
  assert.match(sql, /ALTER COLUMN provider_account_id DROP NOT NULL/);
  assert.match(
    sql,
    /provider_account_id IS NULL OR btrim\(provider_account_id\) <> ''/
  );
  assert.doesNotMatch(sql, /0003_billing_subject_finality/);
});

function declaredMollie() {
  return {
    accessToken: "access_test",
    credentialKind: "advanced_access_token" as const,
    sdk: class {
      customers = {};
      paymentLinks = {};
      payments = {};
      refunds = {};
      subscriptions = {};
    },
  };
}

function createPreservingConnectionSql(id = "conn_1") {
  const byAccountReference = new Map<
    string,
    { id: string; providerAccountId: string | null }
  >();
  let upserts = 0;
  return {
    byAccountReference,
    discover(accountReference: string, providerAccountId: string) {
      const row = byAccountReference.get(accountReference);
      if (row) {
        row.providerAccountId = providerAccountId;
      }
    },
    async query(sql: string, params: readonly unknown[] = []) {
      if (sql.includes("ON CONFLICT") && sql.includes("RETURNING")) {
        upserts += 1;
        const incoming =
          typeof params[6] === "string" ? params[6] : null;
        const accountReference =
          typeof params[7] === "string" ? params[7] : undefined;
        if (accountReference == null) {
          throw new Error("upsert SQL missing account_reference");
        }
        const existing = byAccountReference.get(accountReference);
        if (existing) {
          existing.providerAccountId = incoming ?? existing.providerAccountId;
          return {
            rows: [
              {
                id: existing.id,
                webhook_ingress_token: WEBHOOK_INGRESS_TOKEN,
              },
            ],
          };
        }
        byAccountReference.set(accountReference, {
          id,
          providerAccountId: incoming,
        });
        return {
          rows: [{ id, webhook_ingress_token: WEBHOOK_INGRESS_TOKEN }],
        };
      }
      return { rows: [] };
    },
    get upserts() {
      return upserts;
    },
  };
}

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

test("configured Mollie materializes provider_account_id NULL", async () => {
  const sql = createPreservingConnectionSql();
  const result = await materializeConfiguredBillingConnections({
    applicationId: "app-null-provider-account",
    configuredProviders: { mollie: declaredMollie() },
    sql,
    testMode: true,
  });
  assert.equal(result.connections.length, 1);
  assert.equal(sql.upserts, 1);
  assert.equal(
    sql.byAccountReference.get("app-null-provider-account-mollie-test")
      ?.providerAccountId,
    null
  );
});

test("rematerialize with null intent keeps a discovered provider_account_id", async () => {
  const sql = createPreservingConnectionSql("conn_keep");
  const input = {
    applicationId: "app-keep-discovered",
    configuredProviders: { mollie: declaredMollie() },
    sql,
    testMode: true as const,
  };
  await materializeConfiguredBillingConnections(input);
  sql.discover("app-keep-discovered-mollie-test", "org_discovered");
  const second = await materializeConfiguredBillingConnections(input);
  assert.equal(second.connections[0]?.id, "conn_keep");
  assert.equal(
    sql.byAccountReference.get("app-keep-discovered-mollie-test")
      ?.providerAccountId,
    "org_discovered"
  );
});

test("configured-connection materialize single-flights and does not retry failure", async () => {
  const key = configuredBillingConnectionInitKey({
    applicationId: `app-single-flight-${crypto.randomUUID()}`,
    testMode: true,
  });
  let runs = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const run = async () => {
    runs += 1;
    await gate;
    return { connections: [] };
  };
  const first = singleFlightConfiguredBillingConnectionMaterialize(key, run);
  const second = singleFlightConfiguredBillingConnectionMaterialize(key, run);
  release();
  await Promise.all([first, second]);
  assert.equal(runs, 1);

  const failKey = configuredBillingConnectionInitKey({
    applicationId: `app-single-flight-fail-${crypto.randomUUID()}`,
    testMode: true,
  });
  let failRuns = 0;
  const fail = () => {
    failRuns += 1;
    return Promise.reject(new Error("materialize failed"));
  };
  await assert.rejects(
    () => singleFlightConfiguredBillingConnectionMaterialize(failKey, fail),
    /materialize failed/
  );
  await assert.rejects(
    () => singleFlightConfiguredBillingConnectionMaterialize(failKey, fail),
    /materialize failed/
  );
  assert.equal(failRuns, 1);
});

test("failed billing capabilities do not query Postgres", async () => {
  let queries = 0;
  const runtime = createLocalBillingRuntime({
    configuredProviders: { mollie: declaredMollie() },
    connectionState: {
      connections: [],
      initializationFailed: true,
      initializationMessage: "null value in column provider_account_id",
      initialized: false,
    },
    invocation: PROCESS_BILLING_INVOCATION,
    ready: new Promise(() => {}),
    registry: createBillingProviderRegistry({
      mollie: declaredMollie(),
    }),
    sql: {
      async query() {
        queries += 1;
        throw new Error("billing must not query after bootstrap failure");
      },
    },
    testMode: true,
  });
  const first = await runtime.getCapabilities({ provider: "mollie" });
  const second = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(first.diagnostics?.initializationFailed, true);
  assert.equal(second.diagnostics?.initializationFailed, true);
  assert.equal(first.initialized, false);
  assert.equal(queries, 0);
});

test("unresolved Mollie account id materializes once while Auth sign-in and passkey options succeed", async () => {
  const applicationId = `app-isolate-${crypto.randomUUID()}`;
  const sql = createPreservingConnectionSql();
  const configuredProviders = { mollie: declaredMollie() };
  const connectionState = {
    connections: [] as {
      accountReference: string;
      credentialReference: string;
      id: string;
      provider: "mollie";
      webhookIngressToken: string;
    }[],
    initialized: false,
  };
  const initKey = configuredBillingConnectionInitKey({
    applicationId,
    testMode: true,
  });
  const init = singleFlightConfiguredBillingConnectionMaterialize(initKey, () =>
    materializeConfiguredBillingConnections({
      applicationId,
      configuredProviders,
      sql,
      testMode: true,
    })
  );
  const ready = init.then((result) => {
    connectionState.connections = [...result.connections];
    connectionState.initialized = true;
  });
  const billing = createLocalBillingRuntime({
    configuredProviders,
    connectionState,
    invocation: PROCESS_BILLING_INVOCATION,
    ready,
    registry: createBillingProviderRegistry(configuredProviders),
    sql,
    testMode: true,
  });
  const auth = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const signUp = await auth.handle(
    new Request("http://app.local/api/auth/sign-up/email", {
      body: JSON.stringify({
        email: "isolate@example.com",
        password: "Password123!",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
  assert.equal(signUp.status, 200);
  const [signIn, passkeyOptions, capabilities, rematerialize] =
    await Promise.all([
      auth.handle(
        new Request("http://app.local/api/auth/sign-in/email", {
          body: JSON.stringify({
            email: "isolate@example.com",
            password: "Password123!",
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      ),
      auth.handle(
        new Request(
          "http://app.local/api/auth/passkey/generate-authenticate-options",
          {
            body: "{}",
            headers: { "content-type": "application/json" },
            method: "POST",
          }
        )
      ),
      billing.getCapabilities({ provider: "mollie" }),
      singleFlightConfiguredBillingConnectionMaterialize(initKey, () =>
        materializeConfiguredBillingConnections({
          applicationId,
          configuredProviders,
          sql,
          testMode: true,
        })
      ),
    ]);
  assert.equal(signIn.status, 200);
  assert.equal(passkeyOptions.status, 200);
  assert.equal(capabilities.runtime, "local");
  assert.equal(capabilities.initialized, true);
  assert.equal(capabilities.diagnostics?.initializationFailed, undefined);
  assert.equal(sql.upserts, 1);
  assert.equal(rematerialize.connections.length, 1);
  assert.equal(
    sql.byAccountReference.get(`${applicationId}-mollie-test`)
      ?.providerAccountId,
    null
  );
});
