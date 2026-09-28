declare const platformAssignmentRevisionBrand: unique symbol;
declare const organizationAssignmentRevisionBrand: unique symbol;

export type PlatformAssignmentRevision = number & {
  readonly [platformAssignmentRevisionBrand]: true;
};

export type OrganizationAssignmentRevision = number & {
  readonly [organizationAssignmentRevisionBrand]: true;
};

export interface PlatformUserRoleAssignment {
  readonly roleIds: readonly string[];
  readonly userId: string;
}

export interface PlatformUserAssignmentSnapshot {
  readonly assignments: readonly PlatformUserRoleAssignment[];
  readonly revision: PlatformAssignmentRevision;
}

export interface OrganizationMemberRoleAssignment {
  readonly memberId: string;
  readonly roleIds: readonly string[];
  readonly userId: string;
}

export interface OrganizationMemberAssignmentSnapshot {
  readonly assignments: readonly OrganizationMemberRoleAssignment[];
  readonly organizationId: string;
  readonly revision: OrganizationAssignmentRevision;
}

export function asPlatformAssignmentRevision(
  value: number
): PlatformAssignmentRevision {
  return value as PlatformAssignmentRevision;
}

export function asOrganizationAssignmentRevision(
  value: number
): OrganizationAssignmentRevision {
  return value as OrganizationAssignmentRevision;
}

export function freezeRoleIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...ids]);
}

export function clonePlatformUserAssignment(
  assignment: PlatformUserRoleAssignment
): PlatformUserRoleAssignment {
  return Object.freeze({
    roleIds: freezeRoleIds(assignment.roleIds),
    userId: assignment.userId,
  });
}

export function cloneOrganizationMemberAssignment(
  assignment: OrganizationMemberRoleAssignment
): OrganizationMemberRoleAssignment {
  return Object.freeze({
    memberId: assignment.memberId,
    roleIds: freezeRoleIds(assignment.roleIds),
    userId: assignment.userId,
  });
}

export function groupPlatformUserAssignments(
  rows: readonly { roleId: string; userId: string }[],
  userIds?: readonly string[]
): PlatformUserRoleAssignment[] {
  const grouped = new Map<string, string[]>();
  const wanted = userIds == null ? null : [...userIds];
  if (wanted) {
    for (const userId of wanted) {
      grouped.set(userId, []);
    }
  }
  for (const row of rows) {
    if (wanted && !grouped.has(row.userId)) {
      continue;
    }
    const bucket = grouped.get(row.userId) ?? [];
    bucket.push(row.roleId);
    grouped.set(row.userId, bucket);
  }
  return [...grouped.entries()].map(([userId, roleIds]) =>
    clonePlatformUserAssignment({ roleIds, userId })
  );
}

export function groupOrganizationMemberAssignments(
  rows: readonly {
    memberId: string;
    roleId: string;
    userId: string;
  }[]
): OrganizationMemberRoleAssignment[] {
  const grouped = new Map<string, { roleIds: string[]; userId: string }>();
  for (const row of rows) {
    const bucket = grouped.get(row.memberId) ?? {
      roleIds: [],
      userId: row.userId,
    };
    bucket.roleIds.push(row.roleId);
    grouped.set(row.memberId, bucket);
  }
  return [...grouped.entries()].map(([memberId, value]) =>
    cloneOrganizationMemberAssignment({
      memberId,
      roleIds: value.roleIds,
      userId: value.userId,
    })
  );
}
