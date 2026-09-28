import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAthenaBillingCatalog } from "../../../billing/runtime/local/catalog/normalize.ts";
import type { AthenaBillingCatalogConfig } from "../../../billing/types.ts";
import {
  AUTH_UI_BILLING_PRESET_TABLES,
  EMBEDDED_BILLING_MIGRATIONS,
  EMBEDDED_BILLING_REQUIRED_COLUMNS,
  EMBEDDED_BILLING_REQUIRED_TABLES,
} from "../../../migrations/embedded-billing/catalog.ts";
import { EMBEDDED_CHAT_REQUIRED_TABLES } from "../../../migrations/embedded-chat/catalog.ts";
import { EMBEDDED_EVENT_INGRESS_REQUIRED_TABLES } from "../../../migrations/embedded-event-ingress/catalog.ts";

type BillingValidationCheck = {
  detail?: string;
  group: "billing";
  id: string;
  status: "ok" | "warn" | "error" | "skip";
  title: string;
};

export interface LocalBillingValidateInput {
  catalog?: AthenaBillingCatalogConfig;
  providers?: {
    mollie?: unknown;
    stripe?: unknown;
  };
}

export function collectLocalBillingValidationChecks(
  input: LocalBillingValidateInput | null | undefined
): BillingValidationCheck[] {
  if (input == null) {
    return [];
  }
  const hasProviders =
    input.providers?.mollie != null || input.providers?.stripe != null;
  const hasCatalog = input.catalog != null;
  if (!(hasProviders || hasCatalog)) {
    return [
      {
        detail:
          "athena.config.ts modules.billing enables packaged SQL only. Mollie credentials and billing.catalog live on createClient({ billing }) and are not visible to validate.",
        group: "billing",
        id: "billing.runtime.createClient",
        status: "skip",
        title: "Runtime billing",
      },
    ];
  }
  const checks: BillingValidationCheck[] = [];
  const mollieConfigured = input.providers?.mollie != null;
  const stripeConfigured = input.providers?.stripe != null;
  checks.push({
    detail: mollieConfigured
      ? "configured"
      : stripeConfigured
        ? "not configured (Stripe is registered separately)"
        : "not configured",
    group: "billing",
    id: "billing.provider.mollie",
    status: mollieConfigured || stripeConfigured ? "ok" : "warn",
    title: "Provider · Mollie",
  });
  if (stripeConfigured) {
    checks.push({
      detail: "configured",
      group: "billing",
      id: "billing.provider.stripe",
      status: "ok",
      title: "Provider · Stripe",
    });
  }

  let productsCount = 0;
  let pricesCount = 0;
  let catalogNormalized = false;
  try {
    const normalized = normalizeAthenaBillingCatalog(input.catalog);
    catalogNormalized = normalized != null;
    productsCount = normalized?.products?.length ?? 0;
    pricesCount = normalized?.prices?.length ?? 0;
    checks.push({
      detail: catalogNormalized
        ? `${productsCount} configured`
        : "billing.catalog.products is not configured",
      group: "billing",
      id: "billing.catalog.products",
      status: catalogNormalized ? "ok" : "warn",
      title: "Catalog · Products",
    });
    checks.push({
      detail:
        catalogNormalized && normalized?.prices != null
          ? `${pricesCount} configured`
          : "billing.catalog.prices is not configured",
      group: "billing",
      id: "billing.catalog.prices",
      status: catalogNormalized && normalized?.prices != null ? "ok" : "warn",
      title: "Catalog · Prices",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      detail: message,
      group: "billing",
      id: "billing.catalog",
      status: "error",
      title: "Catalog",
    });
    return checks;
  }

  const productsAvailable =
    catalogNormalized && input.catalog?.products != null;
  const pricesAvailable = catalogNormalized && input.catalog?.prices != null;
  checks.push({
    detail: productsAvailable
      ? "available"
      : "unavailable · billing.catalog.products is not configured",
    group: "billing",
    id: "billing.capability.products.list",
    status: productsAvailable ? "ok" : "warn",
    title: "Capabilities · products.list",
  });
  checks.push({
    detail: pricesAvailable
      ? "available"
      : "unavailable · billing.catalog.prices is not configured",
    group: "billing",
    id: "billing.capability.prices.list",
    status: pricesAvailable ? "ok" : "warn",
    title: "Capabilities · prices.list",
  });
  checks.push({
    detail: mollieConfigured ? "available" : "unavailable",
    group: "billing",
    id: "billing.capability.invoices.list",
    status: mollieConfigured ? "ok" : "warn",
    title: "Capabilities · invoices.list",
  });
  checks.push({
    detail: mollieConfigured ? "available" : "unavailable",
    group: "billing",
    id: "billing.capability.subscriptions.list",
    status: mollieConfigured ? "ok" : "warn",
    title: "Capabilities · subscriptions.list",
  });
  const hasFinality = EMBEDDED_BILLING_MIGRATIONS.some(
    (migration) => migration.version === 3
  );
  checks.push({
    detail: hasFinality
      ? `embedded catalog ${EMBEDDED_BILLING_REQUIRED_TABLES.join(", ")}`
      : "missing 0003 billing subject finality",
    group: "billing",
    id: "billing.schema.embedded-manifest",
    status: hasFinality ? "ok" : "error",
    title: "Schema · embedded billing tables",
  });
  const missingPresetTables = AUTH_UI_BILLING_PRESET_TABLES.filter(
    (name) =>
      !(EMBEDDED_BILLING_REQUIRED_TABLES as readonly string[]).includes(name)
  );
  checks.push({
    detail:
      missingPresetTables.length === 0
        ? AUTH_UI_BILLING_PRESET_TABLES.join(", ")
        : `Auth UI presets missing from catalog: ${missingPresetTables.join(", ")}`,
    group: "billing",
    id: "billing.schema.auth-ui-presets",
    status: missingPresetTables.length === 0 ? "ok" : "error",
    title: "Catalog · Auth UI billing tables",
  });
  return checks;
}

export const VALIDATE_LEDGER_TABLES = [
  "athena_billing_migrations",
  "athena_chat_schema_migrations",
  "athena_event_ingress_migrations",
] as const;

export type ValidateLedgerTable = (typeof VALIDATE_LEDGER_TABLES)[number];

export function isValidateLedgerTable(
  name: string
): name is ValidateLedgerTable {
  return (VALIDATE_LEDGER_TABLES as readonly string[]).includes(name);
}

export interface EmbeddedSchemaInspectInput {
  athenaTables: readonly string[];
  billingEnabled: boolean;
  billingLedgerVersions: readonly number[];
  billingSubscriptionColumns?: readonly string[];
  billingTables: readonly string[];
  chatEnabled: boolean;
  chatLedgerVersions: readonly number[];
  eventIngressEnabled: boolean;
  eventIngressLedgerVersions: readonly number[];
  publicTables: readonly string[];
}

function missingNames(
  required: readonly string[],
  present: ReadonlySet<string>
): string[] {
  return required.filter((name) => !present.has(name));
}

export function collectEmbeddedSchemaDatabaseChecks(
  input: EmbeddedSchemaInspectInput
): BillingValidationCheck[] {
  const checks: BillingValidationCheck[] = [];
  const billingPresent = new Set(
    input.billingTables.map((name) => name.toLowerCase())
  );
  const publicPresent = new Set(
    input.publicTables.map((name) => name.toLowerCase())
  );
  const athenaPresent = new Set(
    input.athenaTables.map((name) => name.toLowerCase())
  );

  if (input.billingEnabled) {
    const missingTables = missingNames(
      EMBEDDED_BILLING_REQUIRED_TABLES,
      billingPresent
    );
    checks.push({
      detail:
        missingTables.length === 0
          ? EMBEDDED_BILLING_REQUIRED_TABLES.join(", ")
          : `missing ${missingTables.join(", ")}`,
      group: "billing",
      id: "billing.schema.tables",
      status: missingTables.length === 0 ? "ok" : "error",
      title: "Database · billing tables",
    });
    if (input.billingSubscriptionColumns != null) {
      const presentColumns = new Set(
        input.billingSubscriptionColumns.map((column) => column.toLowerCase())
      );
      const requiredColumns = EMBEDDED_BILLING_REQUIRED_COLUMNS.filter(
        (column) =>
          column.schema === "billing" &&
          column.table === "billing_subscriptions"
      ).map((column) => column.column);
      const missingColumns = requiredColumns.filter(
        (column) => !presentColumns.has(column)
      );
      checks.push({
        detail:
          missingColumns.length === 0
            ? requiredColumns.join(", ")
            : `missing ${missingColumns.join(", ")}`,
        group: "billing",
        id: "billing.schema.columns",
        status: missingColumns.length === 0 ? "ok" : "error",
        title: "Database · billing subscription columns",
      });
    }
    const expectedVersions = EMBEDDED_BILLING_MIGRATIONS.map(
      (migration) => migration.version
    );
    const missingVersions = expectedVersions.filter(
      (version) => !input.billingLedgerVersions.includes(version)
    );
    const ledgerPresent = publicPresent.has("athena_billing_migrations");
    checks.push({
      detail: ledgerPresent
        ? missingVersions.length === 0
          ? `athena_billing_migrations ${[...input.billingLedgerVersions].sort((a, b) => a - b).join(",")}`
          : `ledger missing versions ${missingVersions.join(", ")}`
        : "athena_billing_migrations is missing",
      group: "billing",
      id: "billing.schema.ledger",
      status: ledgerPresent && missingVersions.length === 0 ? "ok" : "error",
      title: "Database · billing ledger",
    });
  }

  if (input.billingEnabled || input.eventIngressEnabled) {
    const missingIngress = missingNames(
      EMBEDDED_EVENT_INGRESS_REQUIRED_TABLES,
      athenaPresent
    );
    checks.push({
      detail:
        missingIngress.length === 0
          ? "athena.event_ingress, event_ledger, event_outbox"
          : `missing ${missingIngress.join(", ")}`,
      group: "billing",
      id: "billing.schema.event-ingress",
      status: missingIngress.length === 0 ? "ok" : "error",
      title: "Database · event ingress",
    });
    const ingressLedgerOk =
      publicPresent.has("athena_event_ingress_migrations") &&
      input.eventIngressLedgerVersions.includes(1) &&
      input.eventIngressLedgerVersions.includes(3);
    checks.push({
      detail: ingressLedgerOk
        ? "athena_event_ingress_migrations versions 1,3"
        : "event-ingress ledger is empty or missing operation channel (v3)",
      group: "billing",
      id: "billing.schema.event-ingress-ledger",
      status: ingressLedgerOk ? "ok" : "error",
      title: "Database · event-ingress ledger",
    });
  }

  if (input.chatEnabled) {
    const missingChat = missingNames(
      EMBEDDED_CHAT_REQUIRED_TABLES,
      athenaPresent
    );
    checks.push({
      detail:
        missingChat.length === 0
          ? "nine chat runtime tables"
          : `missing ${missingChat.join(", ")}`,
      group: "billing",
      id: "billing.schema.chat",
      status: missingChat.length === 0 ? "ok" : "error",
      title: "Database · chat schema",
    });
    const chatLedgerOk =
      publicPresent.has("athena_chat_schema_migrations") &&
      input.chatLedgerVersions.includes(1);
    checks.push({
      detail: chatLedgerOk
        ? "athena_chat_schema_migrations version 1"
        : "chat ledger is empty or missing",
      group: "billing",
      id: "billing.schema.chat-ledger",
      status: chatLedgerOk ? "ok" : "error",
      title: "Database · chat ledger",
    });
  }

  return checks;
}

const NEXT_CONFIG_FILES = [
  "next.config.ts",
  "next.config.mjs",
  "next.config.js",
  "next.config.mts",
] as const;

const BILLING_INGRESS_ROUTE_CANDIDATES = [
  "src/app/api/athena/billing/webhook/[[...path]]/route.ts",
  "app/api/athena/billing/webhook/[[...path]]/route.ts",
  "src/app/api/athena/billing/webhook/[...path]/route.ts",
  "app/api/athena/billing/webhook/[...path]/route.ts",
] as const;

function isNextApp(cwd: string): boolean {
  return NEXT_CONFIG_FILES.some((name) => existsSync(join(cwd, name)));
}

function readIfExists(path: string): string | undefined {
  if (!existsSync(path)) {
    return;
  }
  return readFileSync(path, "utf8");
}

function collectRouteSources(dir: string, acc: string[]): void {
  if (!existsSync(dir)) {
    return;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === ".next" ||
      entry.name === "dist"
    ) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectRouteSources(full, acc);
      continue;
    }
    if (entry.name === "route.ts" || entry.name === "route.js") {
      acc.push(readFileSync(full, "utf8"));
    }
  }
}

function usesUnifiedAthenaNextHandler(cwd: string): boolean {
  const sources: string[] = [];
  collectRouteSources(join(cwd, "src", "app"), sources);
  collectRouteSources(join(cwd, "app"), sources);
  return sources.some((source) =>
    /\bcreateAthenaNextHandler\s*\(/.test(source)
  );
}

function billingIngressRouteMount(cwd: string): {
  detail: string;
  ok: boolean;
} {
  for (const relative of BILLING_INGRESS_ROUTE_CANDIDATES) {
    const source = readIfExists(join(cwd, relative));
    if (source === undefined) {
      continue;
    }
    if (/\bbillingIngress\b/.test(source)) {
      return { detail: relative, ok: true };
    }
    if (/\bexport const \{ POST \} = billing\b/.test(source)) {
      return {
        detail: `${relative} mounts Billing RPC instead of BillingIngress.`,
        ok: false,
      };
    }
  }
  return {
    detail: [
      "billing.ingestion.webhooks.enabled=true but no BillingIngress",
      "route was detected.",
      "",
      "Expected:",
      "app/api/athena/billing/webhook/[[...path]]/route.ts",
      "",
      "or use the unified Athena handler.",
    ].join("\n"),
    ok: false,
  };
}

export function collectBillingIngressRouteChecks(input: {
  billingEnabled: boolean;
  cwd?: string;
}): BillingValidationCheck[] {
  const cwd = input.cwd;
  if (!input.billingEnabled || cwd == null || cwd === "") {
    return [];
  }
  if (!isNextApp(cwd)) {
    return [];
  }
  if (usesUnifiedAthenaNextHandler(cwd)) {
    return [
      {
        detail:
          "createAthenaNextHandler dispatches /webhook before Billing RPC",
        group: "billing",
        id: "billing.ingress.route",
        status: "ok",
        title: "Billing webhook ingress",
      },
    ];
  }
  const mount = billingIngressRouteMount(cwd);
  return [
    {
      detail: mount.detail,
      group: "billing",
      id: "billing.ingress.route",
      status: mount.ok ? "ok" : "error",
      title: "Billing webhook ingress",
    },
  ];
}
