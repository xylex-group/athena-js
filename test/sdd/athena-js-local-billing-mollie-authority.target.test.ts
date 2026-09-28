/**
 * Target — PR A0 Mollie credential authority.
 *
 * Changing a declared permission Boolean, API mode, or profile scope must
 * change getCapabilities() before any Mollie HTTP request.
 */

import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ATHENA_BILLING_PROVIDER_CONFIG_INVALID,
  AthenaBillingCapabilityError,
  AthenaBillingProviderError,
} from "../../src/billing/errors.ts";
import type { MollieBillingProviderConfig } from "../../src/billing/providers/types.ts";
import { readBillingCredentialAuthority } from "../../src/billing/runtime/authority.ts";
import type { BillingCapabilities } from "../../src/billing/runtime/capabilities.ts";
import { decideLocalBillingOperationCapability } from "../../src/billing/runtime/local/capability-decision.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const billingDir = join(srcRoot, "billing");
const mollieDir = join(billingDir, "runtime", "local", "providers", "mollie");

const ACCESS_TOKEN = "access_athena_mollie_authority";
const TEST_KEY = "test_athena_mollie_authority";
const LIVE_KEY = "live_athena_mollie_authority";
const PROFILE_A = "pfl_authority_a";
const PROFILE_B = "pfl_authority_b";

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function joinedSources(dir: string): string {
  return collectTsFiles(dir)
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

function readBilling(rel: string): string {
  return readFileSync(join(billingDir, rel), "utf8");
}

async function withMockedFetch<T>(
  handler: typeof fetch,
  run: () => Promise<T>
): Promise<T> {
  const previous = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    return await run();
  } finally {
    globalThis.fetch = previous;
  }
}

function createMollieAuthorityFixture(input: {
  apiMode?: "test" | "live" | "both";
  permissions?: Record<string, { read?: boolean; write?: boolean }>;
  scope?: { kind: "organization" } | { kind: "profile"; profileId: string };
}): MollieBillingProviderConfig {
  return {
    accessToken: ACCESS_TOKEN,
    apiMode: input.apiMode ?? "test",
    authority: {
      permissions: input.permissions ?? {
        payments: { read: true, write: false },
      },
      source: "declared",
    },
    credentialKind: "advanced_access_token",
    profileId: PROFILE_A,
    scope: input.scope ?? { kind: "organization" },
    sdk: FetchMollieSdk,
  };
}

function withRequiredSdk(mollie: object): MollieBillingProviderConfig {
  const existing =
    "sdk" in mollie && mollie.sdk != null ? mollie.sdk : FetchMollieSdk;
  return { ...mollie, sdk: existing } as MollieBillingProviderConfig;
}

function standardApiKeyFixture(input?: {
  liveKey?: string;
  profileId?: string;
  testKey?: string;
}): MollieBillingProviderConfig {
  return {
    credentialKind: "api_key",
    sdk: FetchMollieSdk,
    ...(input?.liveKey === undefined ? {} : { liveKey: input.liveKey }),
    ...(input?.profileId === undefined ? {} : { profileId: input.profileId }),
    ...(input?.testKey === undefined ? {} : { testKey: input.testKey }),
  };
}

function orgAdvancedWithoutBoundProfile(input?: {
  defaultProfileId?: string;
  write?: boolean;
}): MollieBillingProviderConfig {
  return {
    accessToken: ACCESS_TOKEN,
    apiMode: "test",
    authority: {
      permissions: {
        payments:
          input?.write === undefined
            ? { read: true }
            : { read: true, write: input.write },
      },
      source: "declared",
    },
    credentialKind: "advanced_access_token",
    sdk: FetchMollieSdk,
    ...(input?.defaultProfileId === undefined
      ? {}
      : { defaultProfileId: input.defaultProfileId }),
    scope: { kind: "organization" },
  };
}

function createLocalClient(mollie: object, testMode = true) {
  return createClient({
    billing: {
      mode: "local",
      providers: { mollie: withRequiredSdk(mollie) },
      testMode,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
}

async function capabilitiesFor(
  mollie: object,
  input: { profileId?: string; testMode?: boolean } = {}
): Promise<{ capabilities: BillingCapabilities; fetchCalls: number }> {
  let fetchCalls = 0;
  const capabilities = await withMockedFetch(
    (async () => {
      fetchCalls += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch,
    () =>
      createLocalClient(mollie, input.testMode ?? true).billing.getCapabilities(
        {
          profileId: input.profileId,
          provider: "mollie",
        }
      ) as Promise<BillingCapabilities>
  );
  return { capabilities, fetchCalls };
}

test("ACT-BILLING-AUTHORITY-001: Mollie authority must not import Policy, Nucleus, or Schema", () => {
  const src = joinedSources(mollieDir);
  assert.doesNotMatch(src, /runtime\/data\/nucleus/);
  assert.doesNotMatch(src, /from ["'][^"']*nucleus/);
  assert.doesNotMatch(src, /from ["'][^"']*\/policy\//);
  assert.doesNotMatch(src, /from ["'][^"']*\/schema\//);
  assert.doesNotMatch(src, /defineModel|AthenaResourceRef/);
});

test("ACT-BILLING-AUTHORITY-002: A0 adds no migrations or generated models", () => {
  const billingSrc = joinedSources(billingDir);
  assert.doesNotMatch(billingSrc, /CREATE TABLE/i);
  assert.doesNotMatch(billingSrc, /from ["'][^"']*\/migrations\//);
});

test("T-BIL-AUTHORITY-DECLARED-BOOLEAN: flipping payments.write changes getCapabilities before HTTP", async () => {
  const denied = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: false } },
    })
  );
  assert.equal(denied.fetchCalls, 0);
  assert.equal(denied.capabilities.operations["payments.get"]?.available, true);
  assert.equal(
    denied.capabilities.operations["payments.list"]?.available,
    true
  );
  assert.deepEqual(denied.capabilities.operations["payments.create"], {
    available: false,
    reason: "missing_permission",
  });
  assert.deepEqual(denied.capabilities.operations["payments.cancel"], {
    available: false,
    reason: "missing_permission",
  });
  assert.equal(
    JSON.stringify(denied.capabilities).includes(ACCESS_TOKEN),
    false
  );

  const allowed = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: true } },
    })
  );
  assert.equal(allowed.fetchCalls, 0);
  assert.equal(
    allowed.capabilities.operations["payments.create"]?.available,
    true
  );
  assert.equal(
    allowed.capabilities.operations["payments.cancel"]?.available,
    true
  );
});

test("T-BIL-AUTHORITY-EXECUTE-FAIL-CLOSED: missing write never reaches Mollie", async () => {
  let fetchCalls = 0;
  const client = createLocalClient(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: false } },
    })
  );
  await withMockedFetch(
    (async () => {
      fetchCalls += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () =>
          client.billing.payments.create({
            amount: { currency: "EUR", value: "10.00" },
            description: "blocked",
            idempotencyKey: "idem-authority-1",
            provider: "mollie",
          }),
        (error: unknown) =>
          error instanceof AthenaBillingCapabilityError &&
          error.reason === "missing_permission" &&
          error.operation === "payments.create"
      );
    }
  );
  assert.equal(fetchCalls, 0);
});

test("T-BIL-AUTHORITY-MODE-MATRIX: selected API mode gates test vs live", async () => {
  const standardTestLive = await capabilitiesFor(
    withRequiredSdk({ credentialKind: "api_key", testKey: TEST_KEY }),
    { testMode: false }
  );
  assert.equal(standardTestLive.fetchCalls, 0);
  assert.deepEqual(standardTestLive.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });

  const standardLiveTest = await capabilitiesFor(
    withRequiredSdk({ credentialKind: "api_key", liveKey: LIVE_KEY }),
    { testMode: true }
  );
  assert.deepEqual(standardLiveTest.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });

  const advancedTestLive = await capabilitiesFor(
    createMollieAuthorityFixture({
      apiMode: "test",
      permissions: { payments: { read: true, write: true } },
    }),
    { testMode: false }
  );
  assert.deepEqual(advancedTestLive.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });

  const advancedBothLive = await capabilitiesFor(
    createMollieAuthorityFixture({
      apiMode: "both",
      permissions: { payments: { read: true, write: true } },
    }),
    { testMode: false }
  );
  assert.equal(
    advancedBothLive.capabilities.operations["payments.get"]?.available,
    true
  );
});

test("T-BIL-AUTHORITY-PROFILE-SCOPE: profile-restricted credentials reject other profiles", async () => {
  const standard = await capabilitiesFor(
    {
      credentialKind: "api_key",
      profileId: PROFILE_A,
      sdk: FetchMollieSdk,
      testKey: TEST_KEY,
    },
    { profileId: PROFILE_B }
  );
  assert.equal(standard.fetchCalls, 0);
  assert.deepEqual(standard.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });

  const org = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: true } },
      scope: { kind: "organization" },
    }),
    { profileId: PROFILE_B }
  );
  assert.equal(org.capabilities.operations["payments.get"]?.available, true);

  const restricted = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: true } },
      scope: { kind: "profile", profileId: PROFILE_A },
    }),
    { profileId: PROFILE_B }
  );
  assert.deepEqual(restricted.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });
});

test("T-BIL-AUTHORITY-INVOICES: sales invoices require sales-invoices.read, not invoices.read", async () => {
  const missing = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: {
        invoices: { read: true, write: false },
        payments: { read: true, write: true },
      },
    })
  );
  assert.deepEqual(missing.capabilities.operations["invoices.get"], {
    available: false,
    reason: "missing_permission",
  });

  const granted = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: {
        "sales-invoices": { read: true, write: false },
      },
    })
  );
  assert.equal(
    granted.capabilities.operations["invoices.get"]?.available,
    true
  );
  assert.equal(
    granted.capabilities.operations["invoices.list"]?.available,
    true
  );
});

test("T-BIL-AUTHORITY-UNSUPPORTED: unimplemented operations stay unsupported even with permission", async () => {
  const granted = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: {
        payments: { read: true, write: true },
      },
    })
  );
  assert.deepEqual(granted.capabilities.operations["checkout.create"], {
    available: false,
    reason: "unsupported_operation",
  });
});

test("T-BIL-AUTHORITY-PREFIX: API-key and advanced-token prefixes fail closed", async () => {
  const { normalizeMollieBillingProviderConfig } = await import(
    "../../src/billing/runtime/local/providers/config.ts"
  );
  const { AthenaBillingProviderError, AthenaBillingCredentialError } =
    await import("../../src/billing/errors.ts");

  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        credentialKind: "api_key",
        liveKey: TEST_KEY,
        sdk: FetchMollieSdk,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCredentialError &&
      error.code === "ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH"
  );
  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        credentialKind: "api_key",
        sdk: FetchMollieSdk,
        testKey: LIVE_KEY,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingCredentialError &&
      error.code === "ATHENA_BILLING_CREDENTIAL_ENVIRONMENT_MISMATCH"
  );
  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        accessToken: TEST_KEY,
        apiMode: "test",
        credentialKind: "advanced_access_token",
        scope: { kind: "organization" },
        sdk: FetchMollieSdk,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingProviderError &&
      error.code === "ATHENA_BILLING_PROVIDER_CONFIG_INVALID"
  );
  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        accessToken: LIVE_KEY,
        apiMode: "live",
        credentialKind: "advanced_access_token",
        scope: { kind: "organization" },
        sdk: FetchMollieSdk,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingProviderError &&
      error.code === "ATHENA_BILLING_PROVIDER_CONFIG_INVALID"
  );
  assert.equal(
    normalizeMollieBillingProviderConfig({
      accessToken: ACCESS_TOKEN,
      apiMode: "test",
      credentialKind: "advanced_access_token",
      sdk: FetchMollieSdk,
    }).profileId,
    null
  );
  assert.equal(
    normalizeMollieBillingProviderConfig({
      accessToken: ACCESS_TOKEN,
      apiMode: "test",
      credentialKind: "advanced_access_token",
      scope: { kind: "organization" },
      sdk: FetchMollieSdk,
    }).profileId,
    null
  );
  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        accessToken: "acess_misspelled_token",
        apiMode: "test",
        authority: {
          permissions: { payments: { read: true, write: false } },
          source: "declared",
        },
        credentialKind: "advanced_access_token",
        profileId: PROFILE_A,
        scope: { kind: "organization" },
        sdk: FetchMollieSdk,
      }),
    (error: unknown) =>
      error instanceof AthenaBillingProviderError &&
      error.code === "ATHENA_BILLING_PROVIDER_CONFIG_INVALID"
  );
  assert.throws(
    () =>
      createLocalClient(
        withRequiredSdk({
          accessToken: "sk_other_provider_secret",
          apiMode: "test",
          authority: {
            permissions: { payments: { read: true, write: false } },
            source: "declared",
          },
          credentialKind: "advanced_access_token",
          profileId: PROFILE_A,
          scope: { kind: "organization" },
        })
      ),
    (error: unknown) =>
      error instanceof AthenaBillingProviderError &&
      error.code === "ATHENA_BILLING_PROVIDER_CONFIG_INVALID"
  );
});

test("T-BIL-AUTHORITY-SHAPE: capabilities expose safe authority diagnostics", async () => {
  const { capabilities } = await capabilitiesFor(
    createMollieAuthorityFixture({
      apiMode: "both",
      permissions: {
        payments: { read: true, write: false },
        refunds: { read: true, write: true },
      },
      scope: { kind: "organization" },
    })
  );
  assert.deepEqual(capabilities.authority, {
    modes: { live: true, test: true },
    permissions: {
      "payments.read": true,
      "payments.write": false,
      "refunds.read": true,
      "refunds.write": true,
    },
    scope: { kind: "organization" },
    source: "declared",
  });
  assert.equal(
    capabilities.credentials?.credentialKind,
    "advanced_access_token"
  );
});

test("T-BIL-AUTHORITY-STANDARD-KEY: standard API keys are profile-scoped and derived", async () => {
  const { capabilities } = await capabilitiesFor(
    standardApiKeyFixture({
      profileId: PROFILE_A,
      testKey: TEST_KEY,
    })
  );
  assert.equal(capabilities.operations["payments.create"]?.available, true);
  assert.equal(capabilities.operations["customers.get"]?.available, true);
  assert.equal(capabilities.operations["invoices.get"]?.available, true);
  assert.equal(capabilities.operations["invoices.list"]?.available, true);
  assert.match(
    readBilling("runtime/local/providers/token-authority.ts"),
    /"sales-invoices\.read": true/
  );
  assert.equal(capabilities.authority?.source, "derived");
  assert.deepEqual(capabilities.authority?.scope, {
    kind: "profile",
    profileId: PROFILE_A,
  });
  assert.deepEqual(capabilities.authority?.modes, { live: false, test: true });
});

test("T-BIL-AUTHORITY-TRANSPORT: advanced test tokens add testmode without leaking the secret", async () => {
  const seen: string[] = [];
  const client = createLocalClient(
    createMollieAuthorityFixture({
      apiMode: "test",
      permissions: { payments: { read: true, write: false } },
    })
  );
  await withMockedFetch(
    (async (input) => {
      const url = String(input);
      seen.push(url);
      assert.equal(url.includes(ACCESS_TOKEN), false);
      return new Response(
        JSON.stringify({
          amount: { currency: "EUR", value: "10.00" },
          id: "tr_authority",
          metadata: {},
          profileId: PROFILE_A,
          resource: "payment",
          status: "open",
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    }) as typeof fetch,
    () =>
      client.billing.payments.get({
        id: "tr_authority",
        provider: "mollie",
      })
  );
  assert.equal(seen.length, 1);
  assert.match(seen[0] ?? "", /[?&]testmode=true/);
});

test("T-BIL-AUTHORITY-CONTRACT: operation mapping and credential kinds exist", () => {
  const kinds = readBilling("runtime/credentials.ts");
  assert.match(kinds, /advanced_access_token/);
  assert.match(kinds, /organization_access_token/);
  const config = readBilling("providers/types.ts");
  assert.match(config, /advanced_access_token/);
  assert.match(config, /apiMode/);
  assert.match(config, /accessToken/);
  assert.match(config, /defaultProfileId/);
  assert.match(config, /source\?: "declared"/);
  assert.doesNotMatch(config, /source\?: "declared" \| "provider"/);
  const moduleSrc = readBilling("module.ts");
  assert.match(
    moduleSrc,
    /getCapabilities:[\s\S]*Promise<BillingCapabilities>/
  );
  assert.match(
    moduleSrc,
    /rejectUnenforcedRemoteProfileTarget\(input, "getCapabilities"\)/
  );
  assert.doesNotMatch(moduleSrc, /query\.profileId\s*=\s*input\.profileId/);
  const remoteRuntimeSrc = readBilling("runtime/remote/runtime.ts");
  assert.match(
    remoteRuntimeSrc,
    /export function rejectUnenforcedRemoteProfileTarget[\s\S]*reason:\s*"unsupported_operation"/
  );
  const operations = readBilling(
    "runtime/local/providers/operation-authority.ts"
  );
  assert.match(operations, /sales-invoices\.read/);
  assert.match(operations, /payments\.write/);
  assert.doesNotMatch(
    operations,
    /"invoices\.(?:get|list)":\s*\{\s*permissions:\s*\["invoices\.read"\]/
  );
});

test("T-BIL-REMOTE-CAPS-PROFILE: remote getCapabilities rejects unenforced profileId", async () => {
  const client = createClient({
    billing: { mode: "remote" },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const rejected = (error: unknown) =>
    error instanceof AthenaBillingCapabilityError &&
    error.operation === "getCapabilities" &&
    error.reason === "unsupported_operation";
  await assert.rejects(
    () =>
      withMockedFetch(
        (async () => {
          throw new Error("must not call GET /billing/v1/capabilities");
        }) as typeof fetch,
        () =>
          client.billing.getCapabilities({
            connectionId: "11111111-1111-1111-1111-111111111111",
            profileId: PROFILE_B,
          })
      ),
    rejected
  );
});

test("T-BIL-AUTHORITY-COMPATIBLE-FAIL-CLOSED: undeclared org/OAuth tokens grant no operations", async () => {
  const org = await capabilitiesFor(
    withRequiredSdk({
      credentialKind: "organization_access_token",
      profileId: PROFILE_A,
      testToken: ACCESS_TOKEN,
    })
  );
  assert.equal(org.fetchCalls, 0);
  assert.deepEqual(org.capabilities.operations["payments.create"], {
    available: false,
    reason: "missing_permission",
  });
  assert.deepEqual(org.capabilities.operations["invoices.get"], {
    available: false,
    reason: "missing_permission",
  });

  const oauth = await capabilitiesFor(
    withRequiredSdk({
      credentialKind: "oauth_access_token",
      profileId: PROFILE_A,
      testToken: ACCESS_TOKEN,
    })
  );
  assert.deepEqual(oauth.capabilities.operations["payments.list"], {
    available: false,
    reason: "missing_permission",
  });
});

test("T-BIL-AUTHORITY-COMPATIBLE-REQUIRES-PROFILE: org/OAuth tokens require a configured profile", async () => {
  const { normalizeMollieBillingProviderConfig } = await import(
    "../../src/billing/runtime/local/providers/config.ts"
  );
  const { AthenaBillingProviderError } = await import(
    "../../src/billing/errors.ts"
  );
  const rejected = (error: unknown) =>
    error instanceof AthenaBillingProviderError &&
    error.code === "ATHENA_BILLING_PROVIDER_CONFIG_INVALID";

  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        authority: {
          permissions: { payments: { read: true } },
          source: "declared",
        },
        credentialKind: "organization_access_token",
        sdk: FetchMollieSdk,
        testToken: ACCESS_TOKEN,
      }),
    rejected
  );
  assert.throws(
    () =>
      normalizeMollieBillingProviderConfig({
        authority: {
          permissions: { payments: { read: true } },
          source: "declared",
        },
        credentialKind: "oauth_access_token",
        defaultProfileId: "   ",
        profileId: "",
        sdk: FetchMollieSdk,
        testToken: ACCESS_TOKEN,
      }),
    rejected
  );
  assert.throws(
    () =>
      createLocalClient({
        authority: {
          permissions: { payments: { read: true } },
          source: "declared",
        },
        credentialKind: "organization_access_token",
        testToken: ACCESS_TOKEN,
      }),
    rejected
  );

  assert.equal(
    normalizeMollieBillingProviderConfig({
      credentialKind: "organization_access_token",
      defaultProfileId: PROFILE_A,
      sdk: FetchMollieSdk,
      testToken: ACCESS_TOKEN,
    }).profileId,
    PROFILE_A
  );
  assert.equal(
    normalizeMollieBillingProviderConfig({
      credentialKind: "oauth_access_token",
      profileId: PROFILE_A,
      sdk: FetchMollieSdk,
      testToken: ACCESS_TOKEN,
    }).profileId,
    PROFILE_A
  );
  assert.equal(
    normalizeMollieBillingProviderConfig({
      accessToken: ACCESS_TOKEN,
      apiMode: "test",
      credentialKind: "advanced_access_token",
      sdk: FetchMollieSdk,
    }).profileId,
    null
  );
  assert.equal(
    normalizeMollieBillingProviderConfig({
      credentialKind: "api_key",
      sdk: FetchMollieSdk,
      testKey: TEST_KEY,
    }).profileId,
    null
  );
});

test("T-BIL-AUTHORITY-OPTIONAL-DEFAULT-PROFILE: org advanced may omit a default profile", async () => {
  const mollie = orgAdvancedWithoutBoundProfile({ write: true });
  const caps = await capabilitiesFor(mollie);
  assert.equal(caps.fetchCalls, 0);
  assert.equal(caps.capabilities.operations["payments.list"]?.available, true);

  const seen: string[] = [];
  await withMockedFetch(
    async (url) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          _embedded: { payments: [] },
          _links: {},
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    },
    async () => {
      const client = createLocalClient(mollie);
      await client.billing.payments.list({
        limit: 20,
        profileId: PROFILE_B,
      });
      await client.billing.payments.list({ limit: 20 });
    }
  );
  assert.equal(seen.length, 2);
  assert.equal(new URL(seen[0] ?? "").searchParams.get("profileId"), PROFILE_B);
  assert.equal(new URL(seen[1] ?? "").searchParams.get("profileId"), null);
});

test("T-BIL-AUTHORITY-ORG-CREATE-REQUIRES-PROFILE: org token create needs a profile", async () => {
  const mollie = orgAdvancedWithoutBoundProfile({ write: true });
  const unscoped = await capabilitiesFor(mollie);
  assert.equal(unscoped.fetchCalls, 0);
  assert.equal(
    unscoped.capabilities.operations["payments.list"]?.available,
    true
  );
  assert.deepEqual(unscoped.capabilities.operations["payments.create"], {
    available: false,
    reason: "missing_provider_scope",
  });

  const scoped = await capabilitiesFor(mollie, { profileId: PROFILE_B });
  assert.equal(scoped.fetchCalls, 0);
  assert.equal(
    scoped.capabilities.operations["payments.create"]?.available,
    true
  );

  let fetchCalls = 0;
  const client = createLocalClient(mollie);
  await withMockedFetch(
    (async () => {
      fetchCalls += 1;
      return new Response("nope", { status: 500 });
    }) as typeof fetch,
    async () => {
      await assert.rejects(
        () =>
          client.billing.payments.create({
            amount: { currency: "EUR", value: "10.00" },
            description: "org create without profile",
            idempotencyKey: "idem-org-create-profile",
            provider: "mollie",
          }),
        (error: unknown) =>
          error instanceof AthenaBillingCapabilityError &&
          error.reason === "missing_provider_scope" &&
          error.operation === "payments.create"
      );
    }
  );
  assert.equal(fetchCalls, 0);
});

test("T-BIL-AUTHORITY-DEFAULT-PROFILE-ID: defaultProfileId is the configured list selector", async () => {
  const mollie: MollieBillingProviderConfig = {
    accessToken: ACCESS_TOKEN,
    apiMode: "test",
    authority: {
      permissions: { payments: { read: true } },
      source: "declared",
    },
    credentialKind: "advanced_access_token",
    defaultProfileId: PROFILE_A,
    scope: { kind: "organization" },
    sdk: FetchMollieSdk,
  };
  const seen: string[] = [];
  await withMockedFetch(
    async (url) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          _embedded: { payments: [] },
          _links: {},
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    },
    () => createLocalClient(mollie).billing.payments.list({ limit: 20 })
  );
  assert.equal(seen.length, 1);
  assert.equal(new URL(seen[0] ?? "").searchParams.get("profileId"), PROFILE_A);
});

test("T-BIL-AUTHORITY-TRIM-PROFILE-ID: configured profile IDs drop surrounding whitespace", async () => {
  const padded = ` ${PROFILE_A} `;
  const scoped = await capabilitiesFor(
    createMollieAuthorityFixture({
      permissions: { payments: { read: true, write: true } },
      scope: { kind: "profile", profileId: padded },
    }),
    { profileId: PROFILE_A }
  );
  assert.equal(scoped.fetchCalls, 0);
  assert.equal(scoped.capabilities.operations["payments.get"]?.available, true);
  assert.deepEqual(scoped.capabilities.authority?.scope, {
    kind: "profile",
    profileId: PROFILE_A,
  });

  const apiKey = await capabilitiesFor(
    standardApiKeyFixture({
      profileId: padded,
      testKey: TEST_KEY,
    })
  );
  assert.deepEqual(apiKey.capabilities.authority?.scope, {
    kind: "profile",
    profileId: PROFILE_A,
  });

  const orgDefault: MollieBillingProviderConfig = {
    accessToken: ACCESS_TOKEN,
    apiMode: "test",
    authority: {
      permissions: { payments: { read: true } },
      source: "declared",
    },
    credentialKind: "advanced_access_token",
    defaultProfileId: padded,
    scope: { kind: "organization" },
    sdk: FetchMollieSdk,
  };
  const seen: string[] = [];
  await withMockedFetch(
    async (url) => {
      seen.push(String(url));
      return new Response(
        JSON.stringify({
          _embedded: { payments: [] },
          _links: {},
        }),
        { headers: { "content-type": "application/json" }, status: 200 }
      );
    },
    () => createLocalClient(orgDefault).billing.payments.list({ limit: 20 })
  );
  assert.equal(new URL(seen[0] ?? "").searchParams.get("profileId"), PROFILE_A);
});

test("T-BIL-AUTHORITY-UNKNOWN-PROFILE: implicit profile rejects an explicit request", async () => {
  const implicit = {
    credentialKind: "api_key" as const,
    testKey: TEST_KEY,
  };
  const unscoped = await capabilitiesFor(withRequiredSdk(implicit));
  assert.equal(
    unscoped.capabilities.operations["payments.get"]?.available,
    true
  );

  const requested = await capabilitiesFor(withRequiredSdk(implicit), {
    profileId: PROFILE_B,
  });
  assert.equal(requested.fetchCalls, 0);
  assert.deepEqual(requested.capabilities.operations["payments.get"], {
    available: false,
    reason: "missing_provider_scope",
  });
});

test("T-BIL-AUTHORITY-NO-FAIL-OPEN: absent authority grants no Mollie permissions", () => {
  const capability = decideLocalBillingOperationCapability({
    anyCredentialConfigured: true,
    operation: "payments.create",
    portAvailable: true,
    provider: "mollie",
    providerConfig: {},
    providerOperationEnabled: true,
    selectedModeAllowed: true,
  });
  assert.deepEqual(capability, {
    available: false,
    reason: "missing_permission",
  });
  assert.equal(readBillingCredentialAuthority({}), undefined);
});

test("T-BIL-AUTHORITY-INCOMPLETE: incomplete authority is a config error", () => {
  assert.throws(
    () =>
      readBillingCredentialAuthority({
        authority: { source: "declared" },
      }),
    (error: unknown) =>
      error instanceof AthenaBillingProviderError &&
      error.code === ATHENA_BILLING_PROVIDER_CONFIG_INVALID
  );
});
