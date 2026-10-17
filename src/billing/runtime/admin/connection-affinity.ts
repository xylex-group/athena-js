import {
  AthenaBillingAuthorizationError,
} from "../../errors.ts";
import type { BillingProviderConfigMap } from "../../providers/types.ts";
import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { BillingOperation } from "../capabilities.ts";
import { isProcessOwnedBillingPrincipal } from "../rights.ts";
import { resolveBillingEnvironment } from "../environment.ts";
import {
  billingConfiguredConnectionOwner,
  inspectBillingConnectionAffinity,
  type BillingConnectionAffinityInspection,
} from "../../subject/connection-affinity.ts";
import {
  configuredBillingCredentialReferences,
} from "../local/providers/connection-binding.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type { BillingProviderName } from "../../types.ts";

function permittedOwners(input: {
  applicationId?: string;
  organizationId?: string;
}): { ownerId: string; ownerKind: string }[] {
  const organizationId = input.organizationId?.trim();
  const tenantOwner = billingConfiguredConnectionOwner(input.applicationId);
  return [
    ...(organizationId
      ? [{ ownerId: organizationId, ownerKind: "organization" }]
      : []),
    ...(tenantOwner ? [tenantOwner] : []),
  ];
}

async function connectionOwner(
  sql: BillingSqlExecutor,
  connectionId: string,
): Promise<{ ownerId: string; ownerKind: string } | undefined> {
  const result = await sql.query(
    `SELECT owner_id, owner_kind
     FROM billing.billing_provider_connections
     WHERE id = $1::uuid AND deleted_at IS NULL
     LIMIT 1`,
    [connectionId],
  );
  const row = result.rows[0];
  return typeof row?.owner_id === "string" &&
    typeof row.owner_kind === "string"
    ? { ownerId: row.owner_id, ownerKind: row.owner_kind }
    : undefined;
}

export async function inspectBillingAdminConnectionAffinity(input: {
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  explicitConnectionId?: string;
  operation: BillingOperation;
  principal: AthenaPrincipal;
  processAuthorized?: boolean;
  provider: BillingProviderName;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<BillingConnectionAffinityInspection> {
  const environment = resolveBillingEnvironment({ testMode: input.testMode }).name;
  const explicitConnectionId = input.explicitConnectionId?.trim();
  const owners = permittedOwners({
    applicationId: input.applicationId,
    organizationId: input.principal.organizationId,
  });
  const processOwned = isProcessOwnedBillingPrincipal(input.principal);
  const processAuthority = input.processAuthorized === true;
  if (!processOwned && !processAuthority && !input.principal.organizationId?.trim()) {
    throw new AthenaBillingAuthorizationError({
      missing: ["active organization"],
      operation: input.operation,
    });
  }
  if (
    explicitConnectionId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      explicitConnectionId,
    )
  ) {
    return { state: "missing" };
  }
  const ownerAllowed = (owner: { ownerId: string; ownerKind: string }) =>
    processOwned ||
    owners.some(
      (candidate) =>
        candidate.ownerId === owner.ownerId &&
        candidate.ownerKind === owner.ownerKind,
    );
  if (explicitConnectionId) {
    const explicitOwner = await connectionOwner(input.sql, explicitConnectionId);
    if (explicitOwner && !ownerAllowed(explicitOwner)) {
      throw new AthenaBillingAuthorizationError({
        missing: ["authorized billing connection"],
        operation: input.operation,
      });
    }
  }
  if (
    configuredBillingCredentialReferences({
      configuredProviders: input.configuredProviders,
      environment,
      provider: input.provider,
    }).length === 0
  ) {
    return { state: "missing" };
  }
  if (explicitConnectionId) {
    return inspectBillingConnectionAffinity({
      configuredProviders: input.configuredProviders,
      environment,
      explicitConnectionId,
      provider: input.provider,
      sql: input.sql,
    });
  }

  const subjectId = input.principal.userId?.trim();
  const inspection = await inspectBillingConnectionAffinity({
    configuredProviders: input.configuredProviders,
    environment,
    ...(processOwned ? { allOwners: true } : { ownerScopes: owners }),
    provider: input.provider,
    sql: input.sql,
    ...(!processOwned && !processAuthority &&
    input.principal.authenticated === true &&
    subjectId
      ? { subjectId, subjectKind: "user" as const }
      : {}),
  });
  if (inspection.state === "resolved") {
    const owner = await connectionOwner(
      input.sql,
      inspection.connection.connectionId,
    );
    if (owner == null) {
      return { state: "missing" };
    }
    if (!ownerAllowed(owner)) {
      throw new AthenaBillingAuthorizationError({
        missing: ["authorized billing connection"],
        operation: input.operation,
      });
    }
  }
  return inspection;
}
