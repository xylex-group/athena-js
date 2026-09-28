import { createAuthDatabaseFromRuntime } from "../../auth/local/database.ts";
import type { AthenaPostgresRuntime } from "../../postgres/owned-runtime.ts";
import { fingerprintAthenaRightsIr } from "../../rights/ir/fingerprint.ts";
import type { AthenaRightKey } from "../../rights/key.ts";
import { rightMatches } from "../../rights/matching.ts";
import { capabilitiesFromRights } from "../../runtime/authorization/capabilities.ts";
import {
  AUTHORIZATION_CATALOG_VERSION,
  getAthenaAuthorizationRight,
  getAthenaAuthorizationRightsIr,
} from "../../runtime/authorization/catalog.ts";
import {
  listAthenaAuthorizationDecisions,
  listAthenaAuthorizationTimeline,
} from "../../runtime/authorization/decisions.ts";
import {
  canonicalGrantId,
  grantIdentityFromAssignment,
  grantSubjectFromAssignment,
} from "../../runtime/authorization/grant-identity.ts";
import type { AthenaAuthorizationInspectGraph } from "../../runtime/authorization/inspect.ts";
import { MemoryAuthorizationStore } from "../../runtime/authorization/memory.ts";
import { PostgresAuthorizationStore } from "../../runtime/authorization/postgres.ts";
import {
  type AthenaAuthorizationStore,
  isInspectableAuthorizationStore,
  isPersistedAuthorizationStore,
} from "../../runtime/authorization/store.ts";
import type { AthenaClientInternals } from "../../runtime/client-internals.ts";
import { authorizationFromUnknownStore } from "../../runtime/data/athena-session.ts";
import {
  getLastAthenaPersistedAuthorizationDiagnostic,
  getLastAthenaRightsResolutionDiagnostic,
  projectAthenaRightsResolutionForDevtools,
} from "../../runtime/data/rights-resolution.ts";
import type {
  AthenaDevtoolsAuthorizationAuthoritySource,
  AthenaDevtoolsAuthorizationDiagnostic,
  AthenaDevtoolsAuthorizationGrantInspector,
  AthenaDevtoolsAuthorizationInspector,
  AthenaDevtoolsAuthorizationInspectorSource,
  AthenaDevtoolsAuthorizationRightDescriptor,
  AthenaDevtoolsAuthorizationRoleInspector,
  AthenaDevtoolsAuthorizationRoleRef,
  AthenaDevtoolsAuthorizationStatus,
  AthenaDevtoolsResolvedRight,
} from "../protocol/authorization.ts";

function splitRight(key: string): { action: string; resource: string } {
  const index = key.indexOf(".");
  if (index < 0) {
    return { action: key, resource: key };
  }
  return { action: key.slice(index + 1), resource: key.slice(0, index) };
}

function catalogFingerprint(): string {
  return fingerprintAthenaRightsIr(getAthenaAuthorizationRightsIr());
}

function catalogDescriptors(): AthenaDevtoolsAuthorizationRightDescriptor[] {
  return getAthenaAuthorizationRightsIr().rights.map((entry) => {
    const parts = splitRight(entry.key);
    return {
      action: parts.action,
      assignable: entry.assignable,
      description: entry.description,
      displayName: entry.displayName,
      domain: entry.domain,
      isPattern: entry.key.includes("*") || entry.key.includes("{"),
      key: entry.key,
      kind: "capability",
      resource: parts.resource,
      riskLevel: entry.riskLevel,
      scopeKind: entry.scopeKind,
      source: "athena-authorization-catalog",
    };
  });
}

function emptyInspector(
  status: AthenaDevtoolsAuthorizationStatus,
  diagnostics: readonly AthenaDevtoolsAuthorizationDiagnostic[] = []
): AthenaDevtoolsAuthorizationInspector {
  const rights = catalogDescriptors();
  const modules = [...new Set(rights.map((entry) => entry.domain))]
    .sort()
    .map((domain) => ({
      domain,
      rightCount: rights.filter((entry) => entry.domain === domain).length,
    }));
  const fingerprint = catalogFingerprint();
  const catalog = {
    fingerprint,
    modules,
    rights,
  };
  const emptyRights = {
    direct: [],
    effective: [],
    inherited: [],
    patterns: [],
  };
  const emptyRoles = {
    direct: [],
    effective: [],
    inherited: [],
    source: [],
  };
  return {
    audit: {
      entries: [],
      events: [...listAthenaAuthorizationTimeline()],
    },
    capabilities: null,
    catalog,
    catalogState: {
      fingerprint,
      rightCount: rights.length,
      version: AUTHORIZATION_CATALOG_VERSION,
    },
    decisions: [...listAthenaAuthorizationDecisions()],
    diagnostics: [...diagnostics],
    grants: [],
    inventory: {
      catalog,
      grants: [],
      roles: [],
    },
    revision: null,
    rights: emptyRights,
    roleResolution: emptyRoles,
    roles: [],
    source: "none",
    status,
    subject: {
      capabilities: null,
      kind: "unknown",
      organizationId: null,
      rights: emptyRights,
      roles: emptyRoles,
      sessionId: null,
      userId: null,
    },
    timings: {
      authorizeMs: null,
      grantResolveMs: null,
      principalResolveMs: null,
      rightsResolveMs: null,
    },
  };
}

function inspectorSource(
  store: AthenaAuthorizationStore
): AthenaDevtoolsAuthorizationInspectorSource {
  if (store instanceof PostgresAuthorizationStore) {
    return "postgres";
  }
  if (store instanceof MemoryAuthorizationStore) {
    return "memory";
  }
  return "unknown";
}

function grantId(assignment: {
  memberId: string | null;
  organizationId: string | null;
  roleId: string;
  scopeKind: "platform" | "organization";
  userId: string | null;
}): string {
  return canonicalGrantId(grantIdentityFromAssignment(assignment));
}

function roleRef(
  role: AthenaAuthorizationInspectGraph["roles"][number],
  source: AthenaDevtoolsAuthorizationRoleRef["source"]
): AthenaDevtoolsAuthorizationRoleRef {
  return {
    assignable: role.assignable,
    displayName: role.name,
    id: role.id,
    key: role.key,
    organizationId: role.organizationId,
    protected: role.protected,
    scopeKind: role.scopeKind,
    source,
    systemKind: role.systemKind,
    version: role.version,
  };
}

function toRoleInspector(
  role: AthenaAuthorizationInspectGraph["roles"][number],
  assignments: AthenaAuthorizationInspectGraph["assignments"]
): AthenaDevtoolsAuthorizationRoleInspector {
  const roleAssignments = assignments.filter(
    (assignment) => assignment.roleId === role.id
  );
  return {
    assignable: role.assignable,
    assignmentCount: role.assignmentCount,
    assignments: roleAssignments.map((assignment) => ({
      subjectId: assignment.userId ?? assignment.memberId ?? role.id,
      userId: assignment.userId,
    })),
    displayName: role.name,
    id: role.id,
    key: role.key,
    organizationId: role.organizationId,
    protected: role.protected,
    rightCount: role.rightCount,
    rights: role.rights,
    scopeKind: role.scopeKind,
    systemKind: role.systemKind,
    version: role.version,
  };
}

function toGrants(
  graph: AthenaAuthorizationInspectGraph
): AthenaDevtoolsAuthorizationGrantInspector[] {
  const byId = new Map(graph.roles.map((role) => [role.id, role]));
  return graph.assignments.map((assignment) => {
    const role = byId.get(assignment.roleId);
    const orphan = !role;
    return {
      createdAt: null,
      expiresAt: null,
      id: grantId(assignment),
      organizationId: assignment.organizationId,
      rightKeys: role?.rights ?? [],
      roleId: assignment.roleId,
      roleKey: assignment.roleKey,
      scopeKind: assignment.scopeKind,
      source: "role",
      status: orphan ? "orphan" : "active",
      subject: {
        id:
          assignment.scopeKind === "organization"
            ? (assignment.memberId ?? assignment.roleId)
            : (assignment.userId ?? assignment.roleId),
        kind: assignment.scopeKind === "organization" ? "member" : "user",
        ...grantSubjectFromAssignment(assignment),
      },
    };
  });
}

function resolveRight(
  key: AthenaRightKey,
  grants: readonly AthenaDevtoolsAuthorizationGrantInspector[]
): AthenaDevtoolsResolvedRight {
  const definition = getAthenaAuthorizationRight(key);
  const parts = splitRight(key);
  const sources: AthenaDevtoolsAuthorizationAuthoritySource[] = grants
    .filter((grant) => grant.rightKeys.some((held) => rightMatches(held, key)))
    .map((grant) => ({
      grantId: grant.id,
      kind: grant.source,
      organizationId: grant.organizationId,
      roleId: grant.roleId,
      roleKey: grant.roleKey,
      scopeKind: grant.scopeKind,
    }));
  return {
    action: parts.action,
    key,
    matchKind: key.includes("*") ? "pattern" : "exact",
    resource: parts.resource,
    scopeKind: definition?.scopeKind ?? "self",
    sources,
  };
}

function diagnosticsFromGraph(
  graph: AthenaAuthorizationInspectGraph,
  grants: readonly AthenaDevtoolsAuthorizationGrantInspector[],
  effective: readonly AthenaDevtoolsResolvedRight[],
  legacy: ReturnType<typeof projectAthenaRightsResolutionForDevtools>
): AthenaDevtoolsAuthorizationDiagnostic[] {
  const diagnostics: AthenaDevtoolsAuthorizationDiagnostic[] = [];
  for (const role of graph.roles) {
    const expectedEmptyRights =
      role.protected === true && role.rights.length === 0;
    if (role.rightCount === 0 && !expectedEmptyRights) {
      diagnostics.push({
        code: "zero-right-role",
        detail: `Role ${role.key} has no rights.`,
        severity: "warning",
      });
    }
    if (role.assignmentCount === 0) {
      diagnostics.push({
        code: "zero-assignment-role",
        detail: `Role ${role.key} has no assignments.`,
        severity: "info",
      });
    }
    for (const key of role.rights) {
      const definition = getAthenaAuthorizationRight(key);
      if (!definition) {
        diagnostics.push({
          code: "unknown-right",
          detail: `Role ${role.key} references unknown right ${key}.`,
          severity: "error",
        });
        continue;
      }
      if (!(definition.assignable || role.protected)) {
        diagnostics.push({
          code: "unassignable-right",
          detail: `Role ${role.key} includes unassignable right ${key}.`,
          severity: "warning",
        });
      }
      const platformRole = role.scopeKind === "platform";
      if (definition.scopeKind === "organization" && platformRole) {
        diagnostics.push({
          code: "scope-invalid-grant",
          detail: `AUTHORIZATION_RIGHT_SCOPE_MISMATCH: ${key} cannot ride on platform role ${role.key}.`,
          severity: "error",
        });
      }
      if (definition.scopeKind === "platform" && !platformRole) {
        diagnostics.push({
          code: "scope-invalid-grant",
          detail: `AUTHORIZATION_RIGHT_SCOPE_MISMATCH: ${key} cannot ride on organization role ${role.key}.`,
          severity: "error",
        });
      }
    }
  }
  for (const grant of grants) {
    if (grant.status === "orphan") {
      diagnostics.push({
        code: "orphan-assignment",
        detail: `Grant ${grant.id} references a missing role.`,
        severity: "error",
      });
    }
  }
  const ids = grants.map((grant) => grant.id);
  if (new Set(ids).size !== ids.length) {
    diagnostics.push({
      code: "duplicate-grant",
      detail: "Duplicate grant identities were projected from assignments.",
      severity: "error",
    });
  }
  for (const right of effective) {
    if (right.sources.length === 0) {
      diagnostics.push({
        code: "incomplete-provenance",
        detail: `Effective right ${right.key} has no grant source metadata.`,
        severity: "warning",
      });
    }
  }
  if (legacy && legacy.source !== "none") {
    diagnostics.push({
      code: "legacy-permission-map",
      detail: `Legacy rightsByRole diagnostic is still present (${legacy.source}/${legacy.mode ?? "unknown"}).`,
      severity: "warning",
    });
  }
  return diagnostics;
}

function isPostgresRuntimeForAuth(
  value: unknown
): value is Pick<
  AthenaPostgresRuntime,
  "inspectPool" | "query" | "transaction"
> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const runtime = value as Partial<AthenaPostgresRuntime>;
  return (
    typeof runtime.inspectPool === "function" &&
    typeof runtime.query === "function" &&
    typeof runtime.transaction === "function"
  );
}

function inspectableStoreFromPostgres(
  internals: AthenaClientInternals | undefined
): AthenaAuthorizationStore | undefined {
  if (!(internals && isPostgresRuntimeForAuth(internals.postgresRuntime))) {
    return;
  }
  return new PostgresAuthorizationStore(
    createAuthDatabaseFromRuntime(internals.postgresRuntime)
  );
}

function missingInspectGraph(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes("inspectGraph is not a function")
  );
}

function unsupportedInspector(
  base: AthenaDevtoolsAuthorizationInspector
): AthenaDevtoolsAuthorizationInspector {
  return {
    ...base,
    diagnostics: [
      ...base.diagnostics,
      {
        code: "inspector-unsupported",
        detail:
          "Authorization inspectGraph is not available on this store. Runtime RBAC is independent of the inspector graph.",
        severity: "warning",
      },
    ],
    source: "unknown",
    status: "ready",
  };
}

type InspectorStoreResolution =
  | { kind: "inspectable"; store: AthenaAuthorizationStore }
  | { kind: "unsupported" }
  | { kind: "absent" };

async function resolveInspectorStore(
  internals: AthenaClientInternals | undefined
): Promise<InspectorStoreResolution> {
  const candidates: unknown[] = [];
  if (internals?.getAuthStores) {
    candidates.push(await internals.getAuthStores());
  }
  if (typeof internals?.authRuntime?.getStores === "function") {
    candidates.push(await internals.authRuntime.getStores());
  }
  let persistedWithoutInspect = false;
  for (const candidate of candidates) {
    if (typeof candidate !== "object" || candidate === null) {
      continue;
    }
    const store = authorizationFromUnknownStore(candidate as never);
    if (isInspectableAuthorizationStore(store)) {
      return { kind: "inspectable", store };
    }
    if (isPersistedAuthorizationStore(store)) {
      persistedWithoutInspect = true;
    }
  }
  if (internals?.getAuthStores || internals?.authRuntime) {
    const reconstructed = inspectableStoreFromPostgres(internals);
    if (reconstructed) {
      return { kind: "inspectable", store: reconstructed };
    }
  }
  if (persistedWithoutInspect) {
    return { kind: "unsupported" };
  }
  return { kind: "absent" };
}

export function produceAthenaDevtoolsAuthorizationInspectorSync(): AthenaDevtoolsAuthorizationInspector {
  const persisted = getLastAthenaPersistedAuthorizationDiagnostic();
  const legacy = projectAthenaRightsResolutionForDevtools(
    getLastAthenaRightsResolutionDiagnostic()
  );
  const inspector = emptyInspector(
    "not-configured",
    legacy
      ? [
          {
            code: "legacy-permission-map",
            detail: `Last role-map diagnostic: ${legacy.reason ?? legacy.source}.`,
            severity: "info",
          },
        ]
      : []
  );
  if (persisted) {
    inspector.subject = {
      ...inspector.subject,
      kind: "user",
      organizationId: null,
      sessionId: null,
      userId: persisted.userId,
    };
    if (persisted.resolution === "failed") {
      inspector.status = "degraded";
      inspector.diagnostics = [
        ...inspector.diagnostics,
        {
          code: "inspect-failed",
          detail:
            persisted.error ?? "Persisted authorization resolution failed.",
          severity: "error",
        },
      ];
    }
  }
  return inspector;
}

export type ProduceAthenaDevtoolsAuthorizationInspectorInput = {
  internals?: AthenaClientInternals;
  principalRights?: readonly AthenaRightKey[];
  sessionAuthenticated?: boolean;
  subject?: {
    organizationId?: string | null;
    sessionId?: string | null;
    userId?: string | null;
  } | null;
};

export async function produceAthenaDevtoolsAuthorizationInspector(
  input?: ProduceAthenaDevtoolsAuthorizationInspectorInput
): Promise<AthenaDevtoolsAuthorizationInspector> {
  const started = performance.now();
  const base = produceAthenaDevtoolsAuthorizationInspectorSync();
  let store: AthenaAuthorizationStore | undefined;
  try {
    const resolved = await resolveInspectorStore(input?.internals);
    if (resolved.kind === "unsupported") {
      return unsupportedInspector(base);
    }
    if (resolved.kind === "absent") {
      return base;
    }
    store = resolved.store;
  } catch (error) {
    return {
      ...base,
      diagnostics: [
        ...base.diagnostics,
        {
          code: "inspect-failed",
          detail:
            error instanceof Error
              ? error.message
              : "Authorization store lookup failed.",
          severity: "error",
        },
      ],
      status: "degraded",
    };
  }
  if (!store || typeof store.inspectGraph !== "function") {
    return unsupportedInspector(base);
  }
  let graph: AthenaAuthorizationInspectGraph;
  const grantStarted = performance.now();
  try {
    graph = await store.inspectGraph();
  } catch (error) {
    if (missingInspectGraph(error)) {
      return unsupportedInspector(base);
    }
    return {
      ...base,
      diagnostics: [
        ...base.diagnostics,
        {
          code: "inspect-failed",
          detail:
            error instanceof Error
              ? error.message
              : "Authorization inspectGraph failed.",
          severity: "error",
        },
      ],
      status: "degraded",
      timings: {
        ...base.timings,
        grantResolveMs: performance.now() - grantStarted,
      },
    };
  }
  const grantResolveMs = performance.now() - grantStarted;
  const grants = toGrants(graph);
  const roles = graph.roles.map((role) =>
    toRoleInspector(role, graph.assignments)
  );
  const persisted = getLastAthenaPersistedAuthorizationDiagnostic();
  const subjectProvided = input != null && "subject" in input;
  const userId = subjectProvided
    ? (input.subject?.userId ?? null)
    : (input?.subject?.userId ?? persisted?.userId ?? base.subject.userId);
  const organizationId = subjectProvided
    ? (input.subject?.organizationId ?? null)
    : (input?.subject?.organizationId ?? base.subject.organizationId);
  const sessionId = subjectProvided
    ? (input.subject?.sessionId ?? null)
    : (input?.subject?.sessionId ?? base.subject.sessionId);
  const rightsStarted = performance.now();
  let effectiveKeys: AthenaRightKey[] = [];
  const stores = input?.internals?.getAuthStores
    ? await input.internals.getAuthStores()
    : undefined;
  if (userId) {
    try {
      effectiveKeys = [
        ...(await store.resolveEffectiveRights({
          activeOrganizationId: organizationId,
          getMember: async (memberOrganizationId, memberUserId) => {
            if (typeof stores?.getMember !== "function") {
              return;
            }
            const member = await stores.getMember(
              memberOrganizationId,
              memberUserId
            );
            return member as never;
          },
          userId,
        })),
      ];
    } catch {
      effectiveKeys = [];
    }
  }
  const subjectGrants = userId
    ? grants.filter((grant) => grant.subject.userId === userId)
    : [];
  const effective = effectiveKeys.map((key) =>
    resolveRight(key, subjectGrants)
  );
  const direct = effective.filter((right) =>
    right.sources.some((source) => source.scopeKind === "platform")
  );
  const inherited = effective.filter((right) =>
    right.sources.some((source) => source.scopeKind === "organization")
  );
  const patterns = effective.filter((right) => right.matchKind === "pattern");
  const subjectRoles = userId
    ? graph.roles.filter((role) =>
        graph.assignments.some(
          (assignment) =>
            assignment.roleId === role.id && assignment.userId === userId
        )
      )
    : [];
  const platformRoles = subjectRoles.filter(
    (role) => role.scopeKind === "platform"
  );
  const organizationRoles = subjectRoles.filter(
    (role) => role.scopeKind === "organization"
  );
  const legacy = projectAthenaRightsResolutionForDevtools(
    getLastAthenaRightsResolutionDiagnostic()
  );
  const rightsProjection = {
    direct,
    effective,
    inherited,
    patterns,
  };
  const roleResolution = {
    direct: platformRoles.map((role) => roleRef(role, "role")),
    effective: subjectRoles.map((role) => roleRef(role, "role")),
    inherited: organizationRoles.map((role) => roleRef(role, "assignment")),
    source: subjectGrants.map((grant) => ({
      grantId: grant.id,
      kind: grant.source,
      organizationId: grant.organizationId,
      roleId: grant.roleId,
      roleKey: grant.roleKey,
      scopeKind: grant.scopeKind,
    })),
  };
  const subjectCapabilities = userId
    ? capabilitiesFromRights(effectiveKeys)
    : null;
  const sessionAuthenticated = input?.sessionAuthenticated === true;
  const unbound = !userId;
  const unboundSeverity =
    sessionAuthenticated && unbound ? ("error" as const) : ("info" as const);
  const inspectorStatus: AthenaDevtoolsAuthorizationStatus =
    sessionAuthenticated && unbound ? "degraded" : "ready";
  const inspector: AthenaDevtoolsAuthorizationInspector = {
    ...base,
    audit: {
      entries: graph.audit.map((entry) => ({
        action: entry.action,
        actorUserId: entry.actorUserId,
        createdAt: entry.createdAt,
        organizationId: entry.organizationId,
        targetId: entry.targetId,
        targetKind: entry.targetKind,
      })),
      events: [...listAthenaAuthorizationTimeline()],
    },
    capabilities: subjectCapabilities,
    diagnostics: [
      ...diagnosticsFromGraph(graph, grants, effective, legacy),
      ...(unbound
        ? [
            {
              code: "inspector-unbound-subject" as const,
              detail:
                "Authorization inspector has no session principal. Role assignments are inventory, not this subject's effective rights.",
              severity: unboundSeverity,
            },
          ]
        : []),
    ],
    grants,
    inventory: {
      catalog: base.catalog,
      grants,
      roles,
    },
    revision: graph.revision,
    rights: rightsProjection,
    roleResolution,
    roles,
    source: inspectorSource(store),
    status: inspectorStatus,
    subject: {
      capabilities: subjectCapabilities,
      kind: userId ? "user" : "runtime",
      organizationId: organizationId ?? null,
      rights: rightsProjection,
      roles: roleResolution,
      sessionId,
      userId,
    },
    timings: {
      authorizeMs: listAthenaAuthorizationDecisions(1)[0]?.timingMs ?? null,
      grantResolveMs,
      principalResolveMs: performance.now() - started,
      rightsResolveMs: performance.now() - rightsStarted,
    },
  };
  if (legacy?.effectiveRights?.length && effective.length === 0) {
    inspector.diagnostics = [
      ...inspector.diagnostics,
      {
        code: "legacy-grants-string-array",
        detail:
          "A role-map diagnostic still exposes effectiveRights as strings without persisted provenance.",
        severity: "warning",
      },
    ];
  }
  const principalRights = input?.principalRights;
  if (userId && principalRights && principalRights.length > 0) {
    const principalSet = new Set(principalRights);
    const effectiveSet = new Set(effectiveKeys);
    const mismatch =
      principalSet.size !== effectiveSet.size ||
      [...principalSet].some((key) => !effectiveSet.has(key));
    if (mismatch) {
      inspector.diagnostics = [
        ...inspector.diagnostics,
        {
          code: "rights-mismatch",
          detail: `Principal rights (${String(principalRights.length)}) do not match inspector effective rights (${String(effective.length)}).`,
          severity: "error",
        },
      ];
      inspector.status = "degraded";
    }
  }
  return inspector;
}
