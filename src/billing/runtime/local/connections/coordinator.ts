import type { BillingProviderName } from "../../../types.ts";
import type { BillingConfiguredProviderSlot } from "../providers/configuration/ir.ts";
import { deriveConfiguredProviderAccountReference } from "./identity.ts";

export interface BillingConnectionIntent {
  readonly environment: "test" | "live";
  readonly localIdentity: {
    readonly accountReference: string;
  };
  readonly metadata: {
    readonly managedBy: "application_config";
  };
  readonly owner: {
    readonly id: string;
    readonly kind: "tenant";
  };
  readonly provider: BillingProviderName;
  readonly providerIdentity: {
    readonly accountId: string | null;
  };
  readonly slot: {
    readonly credentialKind: string;
    readonly credentialReference: string;
    readonly key: string | null;
  };
}

export function createBillingConnectionIntent(input: {
  applicationId: string;
  environment: "test" | "live";
  slot: BillingConfiguredProviderSlot;
}): BillingConnectionIntent {
  return {
    environment: input.environment,
    localIdentity: {
      accountReference: deriveConfiguredProviderAccountReference({
        applicationId: input.applicationId,
        environment: input.environment,
        provider: input.slot.provider,
        scope: input.slot.slotKey ?? "organization",
      }),
    },
    metadata: { managedBy: "application_config" },
    owner: { id: input.applicationId, kind: "tenant" },
    provider: input.slot.provider,
    providerIdentity: { accountId: null },
    slot: {
      credentialKind: input.slot.credentialKind,
      credentialReference: input.slot.credentialReference,
      key: input.slot.slotKey,
    },
  };
}

export interface BillingConnectionRepository<TConnection> {
  upsertDeclared(intent: BillingConnectionIntent): Promise<TConnection>;
}

export interface BillingConnectionConvergenceResult<TConnection> {
  readonly connections: readonly TConnection[];
  readonly intents: readonly BillingConnectionIntent[];
}

export interface BillingConnectionCoordinatorInput<TConnection> {
  readonly applicationId: string;
  readonly environment: "test" | "live";
  readonly intents: readonly BillingConnectionIntent[];
  readonly repository: BillingConnectionRepository<TConnection>;
}

export async function convergeBillingConnections<TConnection>(
  input: BillingConnectionCoordinatorInput<TConnection>
): Promise<BillingConnectionConvergenceResult<TConnection>> {
  const connections: TConnection[] = [];
  const seen = new Set<string>();
  for (const intent of input.intents) {
    const identity = [
      intent.owner.kind,
      intent.owner.id,
      intent.provider,
      intent.environment,
      intent.slot.credentialReference,
    ].join("\0");
    if (seen.has(identity)) {
      throw new Error(`Duplicate billing connection intent: ${identity}`);
    }
    seen.add(identity);
    connections.push(await input.repository.upsertDeclared(intent));
  }
  return { connections, intents: input.intents };
}
