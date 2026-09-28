import type { AthenaRightKey } from "../../rights/key.ts";
import type { AthenaDevtoolsAuthorizationEvent } from "./authorization-events.ts";

export type AthenaDevtoolsAuthorizationStatus =
  | "ready"
  | "degraded"
  | "unavailable"
  | "not-configured";

export type AthenaDevtoolsAuthorizationScopeKind =
  | "platform"
  | "organization"
  | "self";

export type AthenaDevtoolsAuthorizationMatchKind = "exact" | "pattern";

export type AthenaDevtoolsAuthorizationGrantSource =
  | "role"
  | "assignment"
  | "service"
  | "api-key"
  | "explicit"
  | "legacy";

export type AthenaDevtoolsAuthorizationDiagnosticCode =
  | "unknown-right"
  | "unknown-role"
  | "orphan-assignment"
  | "zero-right-role"
  | "zero-assignment-role"
  | "protected-role-drift"
  | "scope-invalid-grant"
  | "unassignable-right"
  | "duplicate-grant"
  | "expired-grant"
  | "role-version-inconsistency"
  | "catalog-fingerprint-mismatch"
  | "legacy-grants-string-array"
  | "legacy-permission-map"
  | "incomplete-provenance"
  | "catalog-runtime-disagreement"
  | "inspect-failed"
  | "inspector-unsupported"
  | "inspector-unbound-subject"
  | "rights-mismatch";

export type AthenaDevtoolsAuthorizationAuthoritySource = {
  grantId: string | null;
  kind: AthenaDevtoolsAuthorizationGrantSource;
  organizationId: string | null;
  roleId: string | null;
  roleKey: string | null;
  scopeKind: AthenaDevtoolsAuthorizationScopeKind;
};

export type AthenaDevtoolsAuthorizationRoleRef = {
  assignable: boolean;
  displayName: string;
  id: string;
  key: string;
  organizationId: string | null;
  protected: boolean;
  scopeKind: "platform" | "organization";
  source: AthenaDevtoolsAuthorizationGrantSource;
  systemKind: "owner" | "admin" | "member" | null;
  version: number;
};

export type AthenaDevtoolsResolvedRight = {
  action: string;
  key: AthenaRightKey;
  matchKind: AthenaDevtoolsAuthorizationMatchKind;
  resource: string;
  scopeKind: AthenaDevtoolsAuthorizationScopeKind;
  sources: readonly AthenaDevtoolsAuthorizationAuthoritySource[];
};

export type AthenaDevtoolsAuthorizationGrantInspector = {
  createdAt: string | null;
  expiresAt: string | null;
  id: string;
  organizationId: string | null;
  rightKeys: readonly AthenaRightKey[];
  roleId: string | null;
  roleKey: string | null;
  scopeKind: AthenaDevtoolsAuthorizationScopeKind;
  source: AthenaDevtoolsAuthorizationGrantSource;
  status: "active" | "expired" | "orphan";
  subject: {
    id: string;
    kind: "user" | "member" | "service" | "api-key";
    memberId?: string | null;
    userId: string | null;
  };
};

export type AthenaDevtoolsAuthorizationRightDescriptor = {
  action: string;
  assignable: boolean;
  description: string;
  displayName: string;
  domain: string;
  isPattern: boolean;
  key: AthenaRightKey;
  kind: string;
  resource: string;
  riskLevel: string;
  scopeKind: AthenaDevtoolsAuthorizationScopeKind;
  source: string;
};

export type AthenaDevtoolsAuthorizationRightModule = {
  domain: string;
  rightCount: number;
};

export type AthenaDevtoolsAuthorizationRoleInspector = {
  assignable: boolean;
  assignmentCount: number;
  assignments: readonly {
    subjectId: string;
    userId: string | null;
  }[];
  displayName: string;
  id: string;
  key: string;
  organizationId: string | null;
  protected: boolean;
  rightCount: number;
  rights: readonly AthenaRightKey[];
  scopeKind: "platform" | "organization";
  systemKind: "owner" | "admin" | "member" | null;
  version: number;
};

export type AthenaDevtoolsAuthorizationDecisionMatch = {
  held: AthenaRightKey;
  matchKind: AthenaDevtoolsAuthorizationMatchKind;
  required: AthenaRightKey;
};

export type AthenaDevtoolsAuthorizationDecisionInspector = {
  authoritySources: readonly AthenaDevtoolsAuthorizationAuthoritySource[];
  decisionId: string;
  domain: "auth" | "billing" | "data" | "storage" | "devtools";
  effectiveRights: readonly AthenaRightKey[];
  matched: readonly AthenaDevtoolsAuthorizationDecisionMatch[];
  missing: readonly AthenaRightKey[];
  operation: string;
  outcome: "allow" | "deny";
  policy: {
    outcome: string | null;
    policyIds: readonly string[];
  };
  requestId: string | null;
  required: {
    allOf: readonly AthenaRightKey[];
  };
  resource: string | null;
  subject: {
    kind: string;
    organizationId: string | null;
    sessionId: string | null;
    userId: string | null;
  };
  timingMs: number | null;
  traceId: string | null;
};

export type AthenaDevtoolsAuthorizationDiagnostic = {
  code: AthenaDevtoolsAuthorizationDiagnosticCode;
  detail: string;
  severity: "info" | "warning" | "error";
};

export type AthenaDevtoolsAuthorizationInspectorSource =
  | "memory"
  | "postgres"
  | "none"
  | "unknown";

export type AthenaDevtoolsAuthorizationCapabilityFlags = {
  canChangeMemberRole: boolean;
  canDeleteOrganization: boolean;
  canInviteMembers: boolean;
  canManageOrganizationRoles: boolean;
  canManagePlatformRoles: boolean;
  canRemoveMember: boolean;
};

export type AthenaDevtoolsAuthorizationCatalog = {
  fingerprint: string;
  modules: readonly AthenaDevtoolsAuthorizationRightModule[];
  rights: readonly AthenaDevtoolsAuthorizationRightDescriptor[];
};

export type AthenaDevtoolsAuthorizationRightsProjection = {
  direct: readonly AthenaDevtoolsResolvedRight[];
  effective: readonly AthenaDevtoolsResolvedRight[];
  inherited: readonly AthenaDevtoolsResolvedRight[];
  patterns: readonly AthenaDevtoolsResolvedRight[];
};

export type AthenaDevtoolsAuthorizationRoleResolution = {
  direct: readonly AthenaDevtoolsAuthorizationRoleRef[];
  effective: readonly AthenaDevtoolsAuthorizationRoleRef[];
  inherited: readonly AthenaDevtoolsAuthorizationRoleRef[];
  source: readonly AthenaDevtoolsAuthorizationAuthoritySource[];
};

export type AthenaDevtoolsAuthorizationInventory = {
  catalog: AthenaDevtoolsAuthorizationCatalog;
  grants: readonly AthenaDevtoolsAuthorizationGrantInspector[];
  roles: readonly AthenaDevtoolsAuthorizationRoleInspector[];
};

export type AthenaDevtoolsAuthorizationSubjectProjection = {
  capabilities: AthenaDevtoolsAuthorizationCapabilityFlags | null;
  kind: string;
  organizationId: string | null;
  rights: AthenaDevtoolsAuthorizationRightsProjection;
  roles: AthenaDevtoolsAuthorizationRoleResolution;
  sessionId: string | null;
  userId: string | null;
};

export type AthenaDevtoolsAuthorizationInspector = {
  capabilities: AthenaDevtoolsAuthorizationCapabilityFlags | null;
  catalog: AthenaDevtoolsAuthorizationCatalog;
  catalogState: {
    fingerprint: string;
    rightCount: number;
    version: number;
  };
  decisions: readonly AthenaDevtoolsAuthorizationDecisionInspector[];
  diagnostics: readonly AthenaDevtoolsAuthorizationDiagnostic[];
  grants: readonly AthenaDevtoolsAuthorizationGrantInspector[];
  inventory: AthenaDevtoolsAuthorizationInventory;
  rights: AthenaDevtoolsAuthorizationRightsProjection;
  roleResolution: AthenaDevtoolsAuthorizationRoleResolution;
  revision: number | null;
  roles: readonly AthenaDevtoolsAuthorizationRoleInspector[];
  source: AthenaDevtoolsAuthorizationInspectorSource;
  audit: {
    entries: readonly {
      action: string;
      actorUserId: string | null;
      createdAt: string | null;
      organizationId: string | null;
      targetId: string | null;
      targetKind: string | null;
    }[];
    events: readonly AthenaDevtoolsAuthorizationEvent[];
  };
  status: AthenaDevtoolsAuthorizationStatus;
  subject: AthenaDevtoolsAuthorizationSubjectProjection;
  timings: {
    authorizeMs: number | null;
    grantResolveMs: number | null;
    principalResolveMs: number | null;
    rightsResolveMs: number | null;
  };
};

/** @deprecated Prefer catalog.rights. Kept for Auth UI parsers that still read the old list. */
export type AthenaDevtoolsAuthorizationCatalogEntry =
  AthenaDevtoolsAuthorizationRightDescriptor;
