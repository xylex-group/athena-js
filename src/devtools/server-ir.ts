import { fingerprintAthenaCapabilitiesIr } from "../capabilities/ir/fingerprint.ts";
import type { AthenaRootClient } from "../client-brands.ts";
import {
  canonicalizeDocument,
  fingerprintDocument,
} from "../policy/fingerprint.ts";
import { normalizePolicyDefinitions } from "../policy/registry.ts";
import { POLICY_IR_VERSION } from "../policy/types.ts";
import { fingerprintAthenaRightsIr } from "../rights/ir/fingerprint.ts";
import { fingerprintAthenaRolesIr } from "../roles/ir/fingerprint.ts";
import {
  getAthenaClientInternals,
  requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import type { AthenaErrorDomain } from "../runtime/error/ir.ts";
import { errorDescriptorsForDomain } from "../runtime/error/registry.ts";
import { canonicalizeAthenaSchemaIr } from "../schema/ir/canonicalize.ts";
import {
  fingerprintAthenaSchemaIr,
  schemaIrFromModels,
} from "../schema/ir/index.ts";

export type AthenaCanonicalArtifactCategory =
  | "document-ir"
  | "identity-contract"
  | "operational-ir";

export type AthenaCanonicalArtifactId =
  | "capabilities"
  | "schema"
  | "policy"
  | "rights"
  | "roles"
  | "transport"
  | "errors"
  | "migrations"
  | "ingress"
  | "events"
  | "auth-audit";

export interface AthenaCanonicalArtifactDescriptor {
  readonly authority: string;
  readonly available: boolean;
  readonly category: AthenaCanonicalArtifactCategory;
  readonly fingerprint?: string;
  readonly id: AthenaCanonicalArtifactId;
  readonly reason?: string;
  readonly version?: number;
}

export interface AthenaCanonicalArtifactSnapshot {
  readonly descriptor: AthenaCanonicalArtifactDescriptor;
  readonly document: unknown;
}

export interface AthenaCanonicalInspectionPort {
  list(): Promise<readonly AthenaCanonicalArtifactDescriptor[]>;
  read(
    id: AthenaCanonicalArtifactId
  ): Promise<AthenaCanonicalArtifactSnapshot | null>;
}

const ARTIFACT_IDS: readonly AthenaCanonicalArtifactId[] = [
  "capabilities",
  "schema",
  "policy",
  "rights",
  "roles",
  "transport",
  "errors",
  "migrations",
  "ingress",
  "events",
  "auth-audit",
];

const ERROR_DOMAINS: readonly AthenaErrorDomain[] = [
  "internal",
  "gateway",
  "storage",
  "billing",
  "chat",
  "webhook",
  "policy",
  "auth",
  "notifications",
  "data",
];

function unavailable(
  id: AthenaCanonicalArtifactId,
  category: AthenaCanonicalArtifactCategory,
  authority: string,
  reason: string
): AthenaCanonicalArtifactSnapshot {
  return {
    descriptor: { authority, available: false, category, id, reason },
    document: null,
  };
}

function createDescriptor(
  id: AthenaCanonicalArtifactId,
  category: AthenaCanonicalArtifactCategory,
  authority: string,
  document: unknown,
  metadata: { fingerprint?: string; version?: number } = {}
): AthenaCanonicalArtifactSnapshot {
  return {
    descriptor: {
      authority,
      available: true,
      category,
      id,
      ...(metadata.fingerprint ? { fingerprint: metadata.fingerprint } : {}),
      ...(metadata.version === undefined ? {} : { version: metadata.version }),
    },
    document,
  };
}

function schemaSnapshot(
  config: Record<string, unknown>
): AthenaCanonicalArtifactSnapshot {
  if (!config.models) {
    return unavailable(
      "schema",
      "document-ir",
      "@xylex-group/athena/schema",
      "models-unavailable"
    );
  }
  const schema = canonicalizeAthenaSchemaIr(schemaIrFromModels(config.models));
  return createDescriptor(
    "schema",
    "document-ir",
    "@xylex-group/athena/schema",
    schema,
    {
      fingerprint: fingerprintAthenaSchemaIr(schema),
      version: schema.irVersion,
    }
  );
}

function policySnapshot(
  config: Record<string, unknown>
): AthenaCanonicalArtifactSnapshot {
  const policyConfig = config.policies;
  if (!policyConfig || typeof policyConfig !== "object") {
    return unavailable(
      "policy",
      "document-ir",
      "@xylex-group/athena/policy",
      "policies-unavailable"
    );
  }
  const definitions = normalizePolicyDefinitions(
    (policyConfig as Record<string, unknown>).definitions
  );
  const document = canonicalizeDocument({
    irVersion: POLICY_IR_VERSION,
    policies: definitions,
  });
  return createDescriptor(
    "policy",
    "document-ir",
    "@xylex-group/athena/policy",
    document,
    {
      fingerprint: fingerprintDocument({
        irVersion: POLICY_IR_VERSION,
        policies: definitions,
      }),
      version: POLICY_IR_VERSION,
    }
  );
}

function errorSnapshot(): AthenaCanonicalArtifactSnapshot {
  const document = ERROR_DOMAINS.flatMap((domain) =>
    errorDescriptorsForDomain(domain)
  );
  return createDescriptor(
    "errors",
    "document-ir",
    "@xylex-group/athena/runtime/error",
    document
  );
}

function capabilitiesSnapshot(
  internals: ReturnType<typeof requireAthenaRootClientInternals>
): AthenaCanonicalArtifactSnapshot {
  const capabilities = internals.capabilitiesIr;
  if (!capabilities) {
    return unavailable(
      "capabilities",
      "document-ir",
      "@xylex-group/athena/capabilities",
      "capabilities-unavailable"
    );
  }

  return createDescriptor(
    "capabilities",
    "document-ir",
    "@xylex-group/athena/capabilities",
    capabilities,
    {
      fingerprint:
        internals.capabilitiesFingerprint ??
        fingerprintAthenaCapabilitiesIr(capabilities),
      version: capabilities.irVersion,
    }
  );
}

function rightsSnapshot(
  internals: ReturnType<typeof requireAthenaRootClientInternals>
): AthenaCanonicalArtifactSnapshot {
  const document = internals.rightsIr;
  if (!document) {
    return unavailable(
      "rights",
      "identity-contract",
      "@xylex-group/athena/rights",
      "rights-unavailable"
    );
  }
  return createDescriptor(
    "rights",
    "identity-contract",
    "@xylex-group/athena/rights",
    document,
    {
      fingerprint:
        internals.rightsFingerprint ?? fingerprintAthenaRightsIr(document),
      version: document.irVersion,
    }
  );
}

async function rolesSnapshot(
  internals: ReturnType<typeof requireAthenaRootClientInternals>
): Promise<AthenaCanonicalArtifactSnapshot> {
  const document = internals.getRolesIr
    ? await internals.getRolesIr()
    : internals.rolesIr;
  const rightsAuthority = internals.rightsAuthority;
  if (!(document && rightsAuthority)) {
    return unavailable(
      "roles",
      "identity-contract",
      "@xylex-group/athena/roles",
      "authorization-store-unavailable"
    );
  }
  const fingerprint = internals.getRolesIr
    ? fingerprintAthenaRolesIr(document, rightsAuthority)
    : (internals.rolesFingerprint ??
      fingerprintAthenaRolesIr(document, rightsAuthority));
  return createDescriptor(
    "roles",
    "identity-contract",
    "@xylex-group/athena/roles",
    document,
    {
      fingerprint,
      version: document.irVersion,
    }
  );
}

function safeTransportPlan(plan: unknown): unknown {
  const value = plan as {
    auth?: { runtime?: unknown };
    chat?: { transport?: unknown };
    db?: { hasD1?: unknown; hasPool?: unknown; transport?: unknown };
    environment?: unknown;
    storage?: {
      hasR2?: unknown;
      hasUrl?: unknown;
      transport?: unknown;
      wantsLocal?: unknown;
      wantsS3?: unknown;
    };
    trustedNode?: unknown;
  };
  return {
    auth: { runtime: value.auth?.runtime ?? null },
    chat: { transport: value.chat?.transport ?? null },
    db: {
      hasD1: value.db?.hasD1 ?? false,
      hasPool: value.db?.hasPool ?? false,
      transport: value.db?.transport ?? null,
    },
    environment: value.environment ?? null,
    storage: {
      hasR2: value.storage?.hasR2 ?? false,
      hasUrl: value.storage?.hasUrl ?? false,
      transport: value.storage?.transport ?? null,
      wantsLocal: value.storage?.wantsLocal ?? false,
      wantsS3: value.storage?.wantsS3 ?? false,
    },
    trustedNode: value.trustedNode ?? false,
  };
}

function inspectRoot(root: object): {
  readonly list: () => Promise<readonly AthenaCanonicalArtifactDescriptor[]>;
  readonly read: (
    id: AthenaCanonicalArtifactId
  ) => Promise<AthenaCanonicalArtifactSnapshot | null>;
} {
  const internals = requireAthenaRootClientInternals(
    root,
    "createAthenaCanonicalInspectionPort"
  );
  const config = internals.config as unknown as Record<string, unknown>;
  const snapshots = new Map<
    AthenaCanonicalArtifactId,
    AthenaCanonicalArtifactSnapshot
  >();

  snapshots.set("schema", schemaSnapshot(config));
  snapshots.set("policy", policySnapshot(config));
  snapshots.set("rights", rightsSnapshot(internals));
  snapshots.set(
    "transport",
    createDescriptor(
      "transport",
      "operational-ir",
      "@xylex-group/athena/runtime/plan",
      safeTransportPlan(internals.plan)
    )
  );
  snapshots.set("errors", errorSnapshot());
  for (const id of ["migrations", "ingress", "events", "auth-audit"] as const) {
    snapshots.set(
      id,
      unavailable(
        id,
        "operational-ir",
        "@xylex-group/athena/runtime",
        "runtime-inspection-unavailable"
      )
    );
  }

  return {
    list: async () =>
      (
        await Promise.all(
          ARTIFACT_IDS.map(async (id) => {
            if (id === "capabilities") {
              return capabilitiesSnapshot(
                requireAthenaRootClientInternals(
                  root,
                  "createAthenaCanonicalInspectionPort"
                )
              ).descriptor;
            }
            if (id === "rights") {
              return rightsSnapshot(
                requireAthenaRootClientInternals(
                  root,
                  "createAthenaCanonicalInspectionPort"
                )
              ).descriptor;
            }
            if (id === "roles") {
              return (
                await rolesSnapshot(
                  requireAthenaRootClientInternals(
                    root,
                    "createAthenaCanonicalInspectionPort"
                  )
                )
              ).descriptor;
            }
            return snapshots.get(id)?.descriptor;
          })
        )
      ).filter(
        (descriptor): descriptor is AthenaCanonicalArtifactDescriptor =>
          descriptor !== undefined
      ),
    read: async (id) => {
      if (id === "capabilities") {
        return capabilitiesSnapshot(
          requireAthenaRootClientInternals(
            root,
            "createAthenaCanonicalInspectionPort"
          )
        );
      }
      if (id === "rights") {
        return rightsSnapshot(
          requireAthenaRootClientInternals(
            root,
            "createAthenaCanonicalInspectionPort"
          )
        );
      }
      if (id === "roles") {
        return rolesSnapshot(
          requireAthenaRootClientInternals(
            root,
            "createAthenaCanonicalInspectionPort"
          )
        );
      }
      return snapshots.get(id) ?? null;
    },
  };
}

export function createAthenaCanonicalInspectionPort(
  root: AthenaRootClient<object>
): AthenaCanonicalInspectionPort {
  const inspected = inspectRoot(root);
  return {
    async list() {
      return inspected.list();
    },
    async read(id) {
      return inspected.read(id);
    },
  };
}

export function hasAthenaCanonicalInspection(root: object): boolean {
  return getAthenaClientInternals(root) !== undefined;
}
