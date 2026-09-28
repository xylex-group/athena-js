import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingProviderConfigMap } from "../providers/types.ts";
import type { BillingOperation } from "../runtime/capabilities.ts";
import { resolveBillingEnvironment } from "../runtime/environment.ts";
import {
  billingConnectionHasConfiguredCredential,
  configuredBillingCredentialReferences,
  parseBillingCredentialReference,
} from "../runtime/local/providers/connection-binding.ts";
import {
  configuredProviderSlot,
  normalizeBillingProviderConfiguration,
  rawMollieConfig,
  rawStripeConfig,
} from "../runtime/local/providers/configuration/index.ts";
import type { BillingProviderName, BillingSubjectRef } from "../types.ts";
import type { BillingSqlExecutor } from "./repository.ts";

export const BILLING_CONFIGURED_CONNECTION_OWNER_KIND = "tenant" as const;

/** Enough distinct usable ids to distinguish missing / unique / ambiguous. */
const USABLE_CONNECTION_UNIQUENESS_LIMIT = 2;

export type BillingConnectionAffinitySource =
  | "configured_connection"
  | "eligible_connection"
  | "owned_resource"
  | "subject_binding";

export interface BillingConnectionAffinity {
  connectionId: string;
  credentialReference: string;
  environment: "test" | "live";
  provider: string;
  source: BillingConnectionAffinitySource;
}

export type BillingConnectionAffinityInspection =
  | { state: "resolved"; connection: BillingConnectionAffinity }
  | { state: "missing" }
  | { state: "ambiguous" };

export type InspectBillingConnectionAffinityInput = {
  configuredProviders?: BillingProviderConfigMap;
  credentialReference?: string;
  environment?: "test" | "live";
  explicitConnectionId?: string;
  ownerId?: string;
  ownerKind?: string;
  ownedConnectionId?: string | null;
  provider?: BillingProviderName;
  sql: BillingSqlExecutor;
  subjectId?: string;
  subjectKind?: BillingSubjectRef["kind"];
  testMode?: boolean;
};

interface ConnectionRow {
  connection_id?: unknown;
  credential_reference?: unknown;
  environment?: unknown;
  id?: unknown;
  owner_id?: unknown;
  owner_kind?: unknown;
  provider?: unknown;
  status?: unknown;
}

/**
 * Declared `createClient` connections are tenant-owned by application id.
 * Omit these fields when the application id is unknown — eligible fallback
 * must not scan the whole Billing database.
 */
export function billingConfiguredConnectionOwner(applicationId?: string | null):
  | {
    ownerId: string;
    ownerKind: typeof BILLING_CONFIGURED_CONNECTION_OWNER_KIND;
  }
  | undefined {
  const ownerId = applicationId?.trim();
  if (ownerId == null || ownerId.length === 0) {
    return;
  }
  return {
    ownerId,
    ownerKind: BILLING_CONFIGURED_CONNECTION_OWNER_KIND,
  };
}

function connectionError(
  operation: BillingOperation,
  reason: "provider_connection_ambiguous" | "provider_connection_missing",
): AthenaBillingCapabilityError {
  return new AthenaBillingCapabilityError({ operation, reason });
}

function processEnvironment(input: {
  environment?: "test" | "live";
  testMode?: boolean;
}): "test" | "live" {
  return (
    input.environment ??
    resolveBillingEnvironment({ testMode: input.testMode }).name
  );
}

function connectionId(row: ConnectionRow): string | undefined {
  const value = row.id ?? row.connection_id;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function usableAffinityFromRow(
  row: ConnectionRow | undefined,
  source: BillingConnectionAffinitySource,
  input: {
    configuredProviders?: BillingProviderConfigMap;
    environment: "test" | "live";
    provider: string;
  },
): BillingConnectionAffinity | undefined {
  const id = row ? connectionId(row) : undefined;
  const credentialReference =
    typeof row?.credential_reference === "string"
      ? row.credential_reference.trim()
      : "";
  if (
    !id ||
    row?.status !== "active" ||
    row.provider !== input.provider ||
    row.environment !== input.environment ||
    credentialReference.length === 0
  ) {
    return;
  }
  if (input.configuredProviders != null) {
    const usable = billingConnectionHasConfiguredCredential({
      configuredProviders: input.configuredProviders,
      connection: {
        credentialReference,
        provider: input.provider,
        testMode: input.environment === "test",
      },
    });
    if (!usable) {
      return;
    }
  }
  return {
    connectionId: id,
    credentialReference,
    environment: input.environment,
    provider: input.provider,
    source,
  };
}

function distinctUsableAffinities(
  connections: readonly BillingConnectionAffinity[],
): BillingConnectionAffinity[] {
  const byId = new Map<string, BillingConnectionAffinity>();
  for (const connection of connections) {
    byId.set(connection.connectionId, connection);
  }
  return [...byId.values()];
}

function inspectionFromUsable(
  connections: readonly BillingConnectionAffinity[],
): BillingConnectionAffinityInspection {
  const distinct = distinctUsableAffinities(connections);
  if (distinct.length > 1) {
    return { state: "ambiguous" };
  }
  const connection = distinct[0];
  if (connection) {
    return { connection, state: "resolved" };
  }
  return { state: "missing" };
}

function appendUsableCredentialClause(
  query: string,
  filters: unknown[],
  input: {
    column: string;
    configuredProviders?: BillingProviderConfigMap;
    credentialReference?: string;
    environment: "test" | "live";
    provider: string;
  },
): string | undefined {
  if (input.credentialReference) {
    filters.push(input.credentialReference);
    return `${query} AND ${input.column} = $${filters.length}`;
  }
  if (input.configuredProviders == null) {
    return query;
  }
  const refs = configuredBillingCredentialReferences({
    configuredProviders: input.configuredProviders,
    environment: input.environment,
    provider: input.provider,
  });
  if (refs.length === 0) {
    return;
  }
  filters.push(refs);
  return `${query} AND ${input.column} = ANY($${filters.length}::text[])`;
}

async function findConnection(
  sql: BillingSqlExecutor,
  id: string,
): Promise<ConnectionRow | undefined> {
  const result = await sql.query(
    `SELECT id::text AS id, owner_id, owner_kind, provider, environment,
            status, credential_reference
     FROM billing.billing_provider_connections
     WHERE id = $1::uuid
       AND deleted_at IS NULL
     LIMIT 1`,
    [id],
  );
  return result.rows[0];
}

/**
 * Authoritative selectors (owned id, active subject bindings, explicit id)
 * fail closed when unusable. Application owner_* applies only to configured
 * fallback enumeration — subject bindings may target user/org-owned rows.
 */
export async function inspectBillingConnectionAffinity(
  input: InspectBillingConnectionAffinityInput,
): Promise<BillingConnectionAffinityInspection> {
  const environment = processEnvironment(input);
  const provider = input.provider ?? "mollie";
  const usability = {
    configuredProviders: input.configuredProviders,
    environment,
    provider,
  };

  const ownedId = input.ownedConnectionId?.trim();
  if (ownedId) {
    const owned = usableAffinityFromRow(
      await findConnection(input.sql, ownedId),
      "owned_resource",
      usability,
    );
    return owned
      ? { connection: owned, state: "resolved" }
      : { state: "missing" };
  }

  if (input.subjectId && input.subjectKind) {
    const existingBindings = await input.sql.query(
      `SELECT 1
       FROM billing.billing_subject_bindings
       WHERE subject_kind = $1
         AND subject_id = $2
         AND status = 'active'
       LIMIT 1`,
      [input.subjectKind, input.subjectId],
    );
    if (existingBindings.rows.length > 0) {
      const filters: unknown[] = [
        input.subjectKind,
        input.subjectId,
        provider,
        environment,
      ];
      let query = `
        SELECT DISTINCT c.id::text AS id, c.owner_id, c.owner_kind, c.provider,
                c.environment, c.status, c.credential_reference
        FROM billing.billing_subject_bindings b
        INNER JOIN billing.billing_provider_connections c
          ON c.id = b.connection_id
         AND c.deleted_at IS NULL
        WHERE b.subject_kind = $1
          AND b.subject_id = $2
          AND b.status = 'active'
          AND c.status = 'active'
          AND c.provider = $3
          AND c.environment = $4`;
      const withCredentials = appendUsableCredentialClause(query, filters, {
        column: "c.credential_reference",
        configuredProviders: input.configuredProviders,
        credentialReference: input.credentialReference,
        environment,
        provider,
      });
      if (withCredentials == null) {
        return { state: "missing" };
      }
      query = `${withCredentials} LIMIT ${USABLE_CONNECTION_UNIQUENESS_LIMIT}`;
      const bindings = await input.sql.query(query, filters);
      const usableBindings = bindings.rows
        .map((row) =>
          usableAffinityFromRow(row, "subject_binding", usability),
        )
        .filter((row): row is BillingConnectionAffinity => row != null);
      return inspectionFromUsable(usableBindings);
    }
  }

  if (input.explicitConnectionId?.trim()) {
    const configured = usableAffinityFromRow(
      await findConnection(input.sql, input.explicitConnectionId.trim()),
      "configured_connection",
      usability,
    );
    return configured
      ? { connection: configured, state: "resolved" }
      : { state: "missing" };
  }

  if (input.ownerId == null || input.ownerKind == null) {
    return { state: "missing" };
  }

  const filters: unknown[] = [
    provider,
    environment,
    input.ownerId,
    input.ownerKind,
  ];
  let query = `
    SELECT DISTINCT id::text AS id, owner_id, owner_kind, provider, environment,
           status, credential_reference
    FROM billing.billing_provider_connections
    WHERE deleted_at IS NULL
      AND status = 'active'
      AND provider = $1
      AND environment = $2
      AND owner_id = $3
      AND owner_kind = $4`;
  const withCredentials = appendUsableCredentialClause(query, filters, {
    column: "credential_reference",
    configuredProviders: input.configuredProviders,
    credentialReference: input.credentialReference,
    environment,
    provider,
  });
  if (withCredentials == null) {
    return { state: "missing" };
  }
  query = `${withCredentials} LIMIT ${USABLE_CONNECTION_UNIQUENESS_LIMIT}`;
  const eligible = await input.sql.query(query, filters);
  const usableEligible = eligible.rows
    .filter(
      (row) =>
        row.owner_id === input.ownerId && row.owner_kind === input.ownerKind,
    )
    .map((row) => usableAffinityFromRow(row, "eligible_connection", usability))
    .filter((row): row is BillingConnectionAffinity => row != null);
  return inspectionFromUsable(usableEligible);
}

export async function resolveBillingConnectionAffinity(input: {
  configuredProviders?: BillingProviderConfigMap;
  credentialReference?: string;
  environment?: "test" | "live";
  explicitConnectionId?: string;
  operation: BillingOperation;
  ownerId?: string;
  ownerKind?: string;
  ownedConnectionId?: string | null;
  provider?: BillingProviderName;
  sql: BillingSqlExecutor;
  subjectId?: string;
  subjectKind?: BillingSubjectRef["kind"];
  testMode?: boolean;
}): Promise<BillingConnectionAffinity> {
  const inspection = await inspectBillingConnectionAffinity(input);
  if (inspection.state === "resolved") {
    return inspection.connection;
  }
  throw connectionError(
    input.operation,
    inspection.state === "ambiguous"
      ? "provider_connection_ambiguous"
      : "provider_connection_missing",
  );
}

export function configuredProvidersForBillingConnection(input: {
  affinity: BillingConnectionAffinity;
  configuredProviders?: BillingProviderConfigMap;
  operation?: BillingOperation;
}): BillingProviderConfigMap {
  const parsed = parseBillingCredentialReference(
    input.affinity.credentialReference,
  );
  const normalized = normalizeBillingProviderConfiguration({
    configuredProviders: input.configuredProviders,
    environment: input.affinity.environment,
  });
  if (parsed.provider === "mollie") {
    const slot = configuredProviderSlot(
      normalized,
      "mollie",
      parsed.accountId ?? null,
    );
    if (slot == null) {
      throw connectionError(
        input.operation ?? "self.subscription.change",
        "provider_connection_missing",
      );
    }
    return { mollie: rawMollieConfig(slot) };
  }
  const slot = configuredProviderSlot(
    normalized,
    "stripe",
    parsed.accountId ?? null,
  );
  if (slot == null) {
    throw connectionError(
      input.operation ?? "self.subscription.change",
      "provider_connection_missing",
    );
  }
  return { stripe: rawStripeConfig(slot) };
}
