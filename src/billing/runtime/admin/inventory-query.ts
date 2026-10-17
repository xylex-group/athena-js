import { parseAthenaRightKey } from "../../../rights/key.ts";
import { missingRequiredRights } from "../../../rights/matching.ts";
import { AthenaBillingAuthorizationError, AthenaBillingCapabilityError } from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import { inspectBillingAdminConnectionAffinity } from "./connection-affinity.ts";
import { getBillingInventoryPreset, validateBillingInventoryPage } from "./inventory-presets.ts";

const SHARED_INVENTORY_READ = parseAthenaRightKey("billing.admin.inventory.shared.read");

export interface BillingInventoryPage {
  rows: Record<string, unknown>[];
  totalItems: number;
  page: number;
  pageSize: number;
}

function redactWebhookIngressToken(value: unknown): unknown {
  return typeof value === "string"
    ? value.replace(
        /(\/api\/athena\/billing\/webhook\/mollie\/(?:classic|events))\/[A-Za-z0-9_-]{16,128}(?=[?#]|$)/,
        "$1/[redacted]",
      )
    : value;
}

export async function listBillingInventory(input: {
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  principal: AthenaPrincipal;
  presetId: unknown;
  page?: unknown;
  pageSize?: unknown;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingInventoryPage> {
  if (input.principal.authenticated !== true) {
    throw new AthenaBillingAuthorizationError({ missing: ["authenticated"], operation: "admin.inventory.list" });
  }
  const missing = missingRequiredRights(input.principal.rights, [parseAthenaRightKey("billing.admin.inventory.read")]);
  if (missing.length) throw new AthenaBillingAuthorizationError({ missing, operation: "admin.inventory.list" });
  const organizationId = input.principal.organizationId;
  if (!organizationId) throw new AthenaBillingAuthorizationError({ missing: ["active organization"], operation: "admin.inventory.list" });

  const preset = getBillingInventoryPreset(input.presetId);
  const page = validateBillingInventoryPage(input);
  try {
    const connectionIds: string[] = [];
    for (const provider of ["mollie", "stripe"] as const) {
      const inspection = await inspectBillingAdminConnectionAffinity({
        applicationId: input.applicationId,
        configuredProviders: input.configuredProviders,
        operation: "admin.inventory.list",
        principal: input.principal,
        provider,
        sql: input.sql,
        testMode: input.testMode,
      });
      if (inspection.state === "ambiguous") {
        throw new AthenaBillingCapabilityError({
          operation: "admin.inventory.list",
          reason: "provider_connection_ambiguous",
        });
      }
      if (inspection.state === "resolved") {
        connectionIds.push(inspection.connection.connectionId);
      }
    }
    if (connectionIds.length === 0) {
      throw new AthenaBillingCapabilityError({
        operation: "admin.inventory.list",
        reason: "missing_connection",
      });
    }
    const subjectScoped = "subjectScoped" in preset && preset.subjectScoped;
    const sharedScope = !subjectScoped || preset.id === "importCandidates";
    const sharedInventoryRead =
      missingRequiredRights(input.principal.rights, [SHARED_INVENTORY_READ]).length === 0;
    const organizationOwnedConnection =
      "EXISTS (SELECT 1 FROM billing.billing_provider_connections AS scoped_connection WHERE scoped_connection.id = inventory_row.connection_id AND scoped_connection.owner_kind = 'organization' AND scoped_connection.owner_id = $2)";
    const tenantOwnedConnection =
      "EXISTS (SELECT 1 FROM billing.billing_provider_connections AS scoped_connection WHERE scoped_connection.id = inventory_row.connection_id AND scoped_connection.owner_kind = 'tenant' AND scoped_connection.owner_id = $3)";
    const scope = preset.scope === "owner"
      ? "((inventory_row.owner_kind = 'organization' AND inventory_row.owner_id = $1) OR (inventory_row.owner_kind = 'tenant' AND inventory_row.owner_id = $2 AND inventory_row.id::text = ANY($3::text[])))"
      : preset.scope === "subject"
        ? "inventory_row.subject_kind = 'organization' AND inventory_row.subject_id = $1"
        : subjectScoped
          ? `inventory_row.connection_id::text = ANY($1::text[]) AND (${organizationOwnedConnection} OR (${tenantOwnedConnection} AND ((inventory_row.subject_kind = 'organization' AND inventory_row.subject_id = $2)${
              preset.id === "importCandidates"
                ? " OR ((inventory_row.subject_kind IS NULL OR inventory_row.subject_id IS NULL) AND $4::boolean)"
                : ""
            })))`
          : `inventory_row.connection_id::text = ANY($1::text[]) AND (${organizationOwnedConnection} OR (${tenantOwnedConnection} AND $4::boolean))`;
    const from = `billing.${preset.table} AS inventory_row WHERE ${scope}`;
    const scopeParams = preset.scope === "owner"
      ? [organizationId, input.applicationId ?? "", connectionIds]
      : preset.scope === "subject"
        ? [organizationId]
        : [
            connectionIds,
            organizationId,
            input.applicationId ?? "",
            ...(sharedScope ? [sharedInventoryRead] : []),
          ];
    const limitParameter = scopeParams.length + 1;
    const offsetParameter = scopeParams.length + 2;
    if (!input.sql.transaction) {
      throw new AthenaBillingCapabilityError({ operation: "admin.inventory.list", reason: "runtime_unavailable" });
    }
    const result = await input.sql.transaction(async (sql) => {
      await sql.query("SET TRANSACTION READ ONLY");
      await sql.query("SET LOCAL statement_timeout = '5s'");
      const count = await sql.query(
        `SELECT count(*)::bigint AS total FROM ${from}`,
        scopeParams,
      );
      const rows = await sql.query(
        `SELECT ${preset.columns.join(", ")} FROM ${from} ORDER BY inventory_row.${preset.orderBy} DESC NULLS LAST, inventory_row.${preset.rowKey} DESC LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        [...scopeParams, page.pageSize, page.offset],
      );
      return { count: count.rows[0]?.total ?? 0, rows: rows.rows };
    });
    return {
      rows: preset.id === "webhookRegistrations"
        ? result.rows.map((row) => ({ ...row, url: redactWebhookIngressToken(row.url) }))
        : result.rows,
      totalItems: Number(result.count),
      page: page.page,
      pageSize: page.pageSize,
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      throw new AthenaBillingCapabilityError({ operation: "admin.inventory.list", reason: "runtime_unavailable" });
    }
    throw error;
  }
}
