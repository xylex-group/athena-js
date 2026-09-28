export type AthenaAuthorizationGrantScopeKind = "platform" | "organization";
export type AthenaAuthorizationGrantSubjectKind = "user" | "member";

export interface AthenaAuthorizationGrantIdentity {
  organizationId: string | null;
  roleId: string;
  scopeKind: AthenaAuthorizationGrantScopeKind;
  subjectId: string;
  subjectKind: AthenaAuthorizationGrantSubjectKind;
}

export interface AthenaAuthorizationGrantSubject {
  memberId: string | null;
  userId: string | null;
}

export function canonicalGrantId(
  identity: AthenaAuthorizationGrantIdentity
): string {
  if (identity.scopeKind === "platform") {
    return `grant:platform:${identity.subjectKind}:${identity.subjectId}:${identity.roleId}`;
  }
  const organizationId = identity.organizationId ?? "unknown";
  return `grant:organization:${organizationId}:${identity.subjectKind}:${identity.subjectId}:${identity.roleId}`;
}

export function grantIdentityFromAssignment(assignment: {
  memberId: string | null;
  organizationId: string | null;
  roleId: string;
  scopeKind: AthenaAuthorizationGrantScopeKind;
  userId: string | null;
}): AthenaAuthorizationGrantIdentity {
  if (assignment.scopeKind === "organization") {
    const subjectId = assignment.memberId ?? "unknown";
    return {
      organizationId: assignment.organizationId,
      roleId: assignment.roleId,
      scopeKind: "organization",
      subjectId,
      subjectKind: "member",
    };
  }
  return {
    organizationId: null,
    roleId: assignment.roleId,
    scopeKind: "platform",
    subjectId: assignment.userId ?? "unknown",
    subjectKind: "user",
  };
}

export function grantSubjectFromAssignment(assignment: {
  memberId: string | null;
  userId: string | null;
}): AthenaAuthorizationGrantSubject {
  return {
    memberId: assignment.memberId,
    userId: assignment.userId,
  };
}
