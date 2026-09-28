/// <reference types="node" />
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { AthenaBillingCapabilityError } from "../../src/billing/errors.ts";
import { PROCESS_BILLING_INVOCATION } from "../../src/billing/runtime/invocation-authority.ts";
import { createBillingProviderRegistry } from "../../src/billing/runtime/local/providers/create-registry.ts";
import { createMollieBillingProviderRuntime } from "../../src/billing/runtime/local/providers/mollie/runtime.ts";
import { createLocalBillingRuntime } from "../../src/billing/runtime/local/runtime.ts";
import { createClient } from "../../src/v3-client.ts";
import { FetchMollieSdk } from "../helpers/fetch-mollie-sdk.ts";

const TEST_KEY = "test_athena_local_catalog";
const here = dirname(fileURLToPath(import.meta.url));

const catalog = {
  prices: [
    {
      amount: { currency: "EUR", value: "9.00" },
      id: "price_starter",
      interval: "month",
      productId: "prod_starter",
    },
  ],
  products: [
    {
      description: "Starter",
      id: "prod_starter",
      name: "Starter",
    },
  ],
};

function mollieConfigured() {
  return {
    mollie: {
      sdk: FetchMollieSdk,
      testKey: TEST_KEY,
    },
  };
}

test("T-BIL-CATALOG-CAPS-STATIC: native Mollie catalog flags stay false", async () => {
  const { MOLLIE_BILLING_PROVIDER_CAPABILITIES } = await import(
    "../../src/billing/runtime/local/providers/mollie/capabilities.ts"
  );
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["products.list"],
    false
  );
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["prices.list"],
    false
  );
  assert.equal(
    MOLLIE_BILLING_PROVIDER_CAPABILITIES.operations["relations.list"],
    false
  );
  assert.equal(MOLLIE_BILLING_PROVIDER_CAPABILITIES.ports.products, false);
  assert.equal(MOLLIE_BILLING_PROVIDER_CAPABILITIES.ports.prices, false);
  assert.equal(MOLLIE_BILLING_PROVIDER_CAPABILITIES.ports.relations, false);
});

test("T-BIL-CATALOG-PARITY: capability true iff runtime port exists", async () => {
  const without = createMollieBillingProviderRuntime({
    sdk: FetchMollieSdk,
    testKey: TEST_KEY,
  });
  const withoutCaps = await without.getCapabilities({
    credentials: {},
    kind: "configured",
    provider: "mollie",
    providerConfig: {},
  });
  assert.equal(without.relations, undefined);
  assert.equal(withoutCaps.operations["relations.list"], false);
  assert.equal(withoutCaps.operations["products.list"], false);
  assert.equal(withoutCaps.operations["prices.list"], false);
  assert.equal(withoutCaps.ports.products, without.products != null);
  assert.equal(withoutCaps.ports.prices, without.prices != null);

  const withCatalog = createMollieBillingProviderRuntime(
    { sdk: FetchMollieSdk, testKey: TEST_KEY },
    {
      prices: [
        {
          amount: { currency: "EUR", value: "9.00" },
          id: "price_starter",
          metadata: {},
          productId: "prod_starter",
          raw: {},
        },
      ],
      products: [
        {
          id: "prod_starter",
          metadata: {},
          name: "Starter",
          raw: {},
        },
      ],
      relations: null,
    }
  );
  const withCaps = await withCatalog.getCapabilities({
    credentials: {},
    kind: "configured",
    provider: "mollie",
    providerConfig: {},
  });
  assert.ok(withCatalog.products != null);
  assert.ok(withCatalog.prices != null);
  assert.equal(withCaps.operations["products.list"], true);
  assert.equal(withCaps.operations["prices.list"], true);
  assert.equal(withCaps.ports.products, withCatalog.products != null);
  assert.equal(withCaps.ports.prices, withCatalog.prices != null);
  assert.equal(withCaps.operations["checkout.create"], false);
});

test("T-BIL-CATALOG-OWNERSHIP: ports are Athena-owned, not Mollie SDK", () => {
  const catalogDir = join(
    here,
    "..",
    "..",
    "src",
    "billing",
    "runtime",
    "local",
    "catalog"
  );
  const products = readFileSync(join(catalogDir, "products.ts"), "utf8");
  const prices = readFileSync(join(catalogDir, "prices.ts"), "utf8");
  const relations = readFileSync(join(catalogDir, "relations.ts"), "utf8");
  assert.doesNotMatch(products, /callMollieSdk/);
  assert.doesNotMatch(prices, /callMollieSdk/);
  assert.doesNotMatch(relations, /callMollieSdk/);
  assert.doesNotMatch(products, /mollie-api/);
  assert.doesNotMatch(prices, /mollie-api/);
  assert.doesNotMatch(relations, /mollie-api/);
});

test("T-BIL-CATALOG-LIST: configured catalog lists products and prices", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, catalog),
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.operations["products.list"]?.available, true);
  assert.equal(capabilities.operations["prices.list"]?.available, true);
  assert.equal(capabilities.operations["relations.list"]?.available, false);
  assert.equal(capabilities.ports.products, true);
  assert.equal(capabilities.ports.prices, true);
  assert.equal(capabilities.ports.relations, false);

  const products = await runtime.products.list({});
  assert.equal(products.items.length, 1);
  assert.equal(products.items[0]?.id, "prod_starter");
  assert.equal(products.items[0]?.name, "Starter");

  const prices = await runtime.prices.list({});
  assert.equal(prices.items.length, 1);
  assert.equal(prices.items[0]?.id, "price_starter");
  assert.equal(prices.items[0]?.productId, "prod_starter");
  assert.equal(prices.items[0]?.amount.value, "9.00");
});

test("T-BIL-CATALOG-RELATIONS-LIST: configured relations list is Athena-owned", async () => {
  const configured = mollieConfigured();
  const withRelations = {
    ...catalog,
    products: [
      ...catalog.products,
      { description: "Support", id: "prod_support", name: "Support" },
    ],
    relations: [
      {
        id: "rel_addon",
        sourceProductId: "prod_starter",
        targetProductId: "prod_support",
        type: "addon" as const,
      },
    ],
  };
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured, withRelations),
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.operations["relations.list"]?.available, true);
  assert.equal(capabilities.ports.relations, true);
  const relations = await runtime.relations.list({});
  assert.equal(relations.items.length, 1);
  assert.equal(relations.items[0]?.id, "rel_addon");
  assert.equal(relations.items[0]?.type, "addon");
});

test("T-BIL-CATALOG-CLIENT: createClient catalog.prices.list returns BillingPage", async () => {
  const client = createClient({
    billing: {
      catalog,
      mode: "local",
      providers: mollieConfigured(),
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const prices = await client.billing.catalog.prices.list({});
  assert.equal(prices.items[0]?.id, "price_starter");
  const products = await client.billing.catalog.products.list({});
  assert.equal(products.items[0]?.id, "prod_starter");
});

test("T-BIL-CATALOG-UNSUPPORTED: provider without catalog stays fail-closed", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured),
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(capabilities.operations["products.list"]?.available, false);
  assert.equal(capabilities.operations["prices.list"]?.available, false);
  await assert.rejects(
    () => runtime.products.list({}),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.code === "ATHENA_BILLING_OPERATION_UNAVAILABLE" &&
      error.operation === "products.list" &&
      error.reason === "missing_catalog"
  );
  await assert.rejects(
    () => runtime.prices.list({}),
    (error: unknown) =>
      error instanceof AthenaBillingCapabilityError &&
      error.code === "ATHENA_BILLING_OPERATION_UNAVAILABLE" &&
      error.operation === "prices.list" &&
      error.reason === "missing_catalog"
  );
});

test("T-BIL-CATALOG-CAPS-REASON: absent catalog reports missing_catalog", async () => {
  const configured = mollieConfigured();
  const runtime = createLocalBillingRuntime({
    configuredProviders: configured,
    invocation: PROCESS_BILLING_INVOCATION,
    registry: createBillingProviderRegistry(configured),
    testMode: true,
  });
  const capabilities = await runtime.getCapabilities({ provider: "mollie" });
  assert.equal(
    capabilities.operations["prices.list"]?.reason,
    "missing_catalog"
  );
  assert.equal(
    capabilities.operations["products.list"]?.reason,
    "missing_catalog"
  );
});

test("T-BIL-CATALOG-CHAIN: config catalog reaches Mollie runtime ports", async () => {
  const materialize = readFileSync(
    join(
      here,
      "..",
      "..",
      "src",
      "billing",
      "runtime",
      "local",
      "materialize.ts"
    ),
    "utf8"
  );
  const registry = readFileSync(
    join(
      here,
      "..",
      "..",
      "src",
      "billing",
      "runtime",
      "local",
      "providers",
      "create-registry.ts"
    ),
    "utf8"
  );
  const mollieRuntime = readFileSync(
    join(
      here,
      "..",
      "..",
      "src",
      "billing",
      "runtime",
      "local",
      "providers",
      "mollie",
      "runtime.ts"
    ),
    "utf8"
  );
  assert.match(materialize, /createBillingProviderRegistry\(/);
  assert.match(materialize, /config\.billing\?\.catalog/);
  assert.match(registry, /normalizeAthenaBillingCatalog/);
  assert.match(registry, /createBillingProviderDefinitionRegistry/);
  assert.match(registry, /definition\.runtime\.create/);
  assert.match(mollieRuntime, /createAthenaBillingProductsPort/);
  assert.match(mollieRuntime, /createAthenaBillingPricesPort/);

  const client = createClient({
    billing: {
      catalog,
      mode: "local",
      providers: mollieConfigured(),
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const capabilities = await client.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(capabilities.operations["products.list"]?.available, true);
  assert.equal(capabilities.operations["prices.list"]?.available, true);
  assert.ok(client.billing.catalog.products);
  assert.ok(client.billing.catalog.prices);
});

test("T-BIL-CATALOG-NEXT-MINIMAL: example catalog normalizes and lists", async () => {
  const exampleCatalog = readFileSync(
    join(
      here,
      "..",
      "..",
      "..",
      "athena-auth-ui",
      "examples",
      "next-minimal",
      "src",
      "lib",
      "athena",
      "billing",
      "catalog.ts"
    ),
    "utf8"
  );
  assert.match(exampleCatalog, /id:\s*"starter"/);
  assert.match(exampleCatalog, /id:\s*"pro"/);
  assert.match(exampleCatalog, /id:\s*"priority-support"/);
  assert.match(exampleCatalog, /id:\s*"starter-monthly"/);
  assert.match(exampleCatalog, /id:\s*"starter-once"/);
  assert.match(exampleCatalog, /id:\s*"priority-support-once"/);
  assert.match(exampleCatalog, /type:\s*"upsell"/);
  assert.match(exampleCatalog, /type:\s*"addon"/);

  const billingCatalog = {
    prices: [
      {
        amount: { currency: "EUR", value: "9.00" },
        id: "starter-monthly",
        interval: "month",
        productId: "starter",
      },
      {
        amount: { currency: "EUR", value: "29.00" },
        id: "pro-monthly",
        interval: "month",
        productId: "pro",
      },
      {
        amount: { currency: "EUR", value: "99.00" },
        id: "starter-once",
        productId: "starter",
      },
      {
        amount: { currency: "EUR", value: "15.00" },
        id: "priority-support-once",
        productId: "priority-support",
      },
    ],
    products: [
      {
        description: "Starter plan",
        id: "starter",
        name: "Starter",
      },
      {
        description: "Pro plan",
        id: "pro",
        name: "Pro",
      },
      {
        description: "Priority support",
        id: "priority-support",
        name: "Priority support",
      },
    ],
    relations: [
      {
        id: "starter-upsell-pro",
        sourceProductId: "starter",
        targetProductId: "pro",
        type: "upsell" as const,
      },
      {
        id: "starter-addon-priority-support",
        sourceProductId: "starter",
        targetProductId: "priority-support",
        type: "addon" as const,
      },
      {
        id: "pro-addon-priority-support",
        sourceProductId: "pro",
        targetProductId: "priority-support",
        type: "addon" as const,
      },
    ],
  };

  const { normalizeAthenaBillingCatalog } = await import(
    "../../src/billing/runtime/local/catalog/normalize.ts"
  );
  const normalized = normalizeAthenaBillingCatalog(billingCatalog);
  assert.ok(normalized?.products != null);
  assert.ok(normalized?.prices != null);
  assert.ok(normalized?.relations != null);
  assert.equal(normalized.products.length, 3);
  assert.equal(normalized.prices.length, 4);
  assert.equal(normalized.relations.length, 3);

  const client = createClient({
    billing: {
      catalog: billingCatalog,
      mode: "local",
      providers: mollieConfigured(),
      testMode: true,
    },
    key: "ak_test",
    url: "https://athena.example.com",
  });
  const capabilities = await client.billing.getCapabilities({
    provider: "mollie",
  });
  assert.equal(capabilities.operations["products.list"]?.available, true);
  assert.equal(capabilities.operations["prices.list"]?.available, true);
  assert.equal(capabilities.operations["relations.list"]?.available, true);
  const products = await client.billing.catalog.products.list({});
  const prices = await client.billing.catalog.prices.list({});
  const relations = await client.billing.catalog.relations.list({});
  assert.equal(products.items[0]?.id, "starter");
  assert.equal(prices.items[0]?.id, "starter-monthly");
  assert.equal(relations.items[0]?.type, "upsell");
});
