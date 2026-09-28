import { AthenaAuthRuntimeError } from "./errors.ts";
import type {
  AuthMemberRow,
  AuthOrganizationRow,
  AuthSessionRow,
} from "./models.ts";

/**
 * AUTH-ORG-CTX-001: a persisted session MUST NOT reference an organization
 * for which its user lacks membership.
 *
 * AUTH-ORG-CTX-002: any mutation that invalidates membership MUST clear the
 * matching active organization context in the same transaction (all sessions,
 * not a single token).
 */

export const FOUNDING_OWNER_REMOVE_FORBIDDEN =
  "The founding owner cannot be removed from the organization";
export const FOUNDING_OWNER_ROLE_LOCKED = "The founding owner role is locked.";
export const FOUNDING_OWNER_LEAVE_FORBIDDEN =
  "The founding owner can't leave the organization.";
export const LAST_MEMBER_LEAVE_FORBIDDEN =
  "The last member can't leave the organization.";
export const LAST_OWNER_LEAVE_FORBIDDEN =
  "The sole owner can't leave the organization.";
export const LAST_OWNER_REMOVE_FORBIDDEN =
  "The sole owner can't be removed from the organization.";
export const LAST_OWNER_ROLE_LOCKED = "The sole owner role cannot be changed.";
export const SELF_ELEVATION_FORBIDDEN =
  "Members cannot assign themselves a higher role.";
export const GRANT_HIGHER_ROLE_FORBIDDEN =
  "Cannot assign a role above your own.";
export const GRANT_OWNER_FORBIDDEN =
  "Only organization owners can assign the owner role.";

function membershipRank(role: string): number {
  const key = role.trim().toLowerCase();
  if (key === "owner" || key === "organization_owner") {
    return 3;
  }
  if (key === "admin" || key === "organization_admin") {
    return 2;
  }
  if (key === "member" || key === "organization_member") {
    return 1;
  }
  if (key.startsWith("custom_")) {
    return 2;
  }
  return 0;
}

export function assertMemberRoleAssignmentAllowed(input: {
  actorCanAssignOwner: boolean;
  actorRole: string;
  actorUserId: string;
  nextRole: string;
  targetRole: string;
  targetUserId: string;
}): void {
  const nextRank = membershipRank(input.nextRole);
  const actorRank = membershipRank(input.actorRole);
  if (
    input.actorUserId === input.targetUserId &&
    nextRank > membershipRank(input.targetRole)
  ) {
    throw AthenaAuthRuntimeError.forbidden(SELF_ELEVATION_FORBIDDEN);
  }
  if (nextRank > actorRank) {
    throw AthenaAuthRuntimeError.forbidden(GRANT_HIGHER_ROLE_FORBIDDEN);
  }
  if (nextRank >= 3 && !input.actorCanAssignOwner) {
    throw AthenaAuthRuntimeError.forbidden(GRANT_OWNER_FORBIDDEN);
  }
}

export function resolveFoundingOwnerUserId(
  organization: Pick<AuthOrganizationRow, "created_by_user_id"> | undefined,
  members: readonly AuthMemberRow[]
): string | null {
  const stored =
    typeof organization?.created_by_user_id === "string"
      ? organization.created_by_user_id.trim()
      : "";
  if (stored.length > 0) {
    return stored;
  }
  const owners = members
    .filter((member) => member.role === "owner")
    .slice()
    .sort((left, right) => {
      const byTime =
        new Date(left.created_at).getTime() -
        new Date(right.created_at).getTime();
      if (byTime !== 0) {
        return byTime;
      }
      return left.id.localeCompare(right.id);
    });
  return owners[0]?.user_id ?? null;
}

export function assertFoundingOwnerMutationAllowed(input: {
  kind: "leave" | "remove" | "role";
  members: readonly AuthMemberRow[];
  nextRole?: string;
  organization: AuthOrganizationRow | undefined;
  targetUserId: string;
}): void {
  if (input.kind === "role" && input.nextRole === "owner") {
    return;
  }
  const founderId = resolveFoundingOwnerUserId(
    input.organization,
    input.members
  );
  if (founderId !== input.targetUserId) {
    return;
  }
  if (input.kind === "leave") {
    throw AthenaAuthRuntimeError.forbidden(FOUNDING_OWNER_LEAVE_FORBIDDEN);
  }
  if (input.kind === "role") {
    throw AthenaAuthRuntimeError.forbidden(FOUNDING_OWNER_ROLE_LOCKED);
  }
  throw AthenaAuthRuntimeError.forbidden(FOUNDING_OWNER_REMOVE_FORBIDDEN);
}

export function assertLastOwnerMutationAllowed(input: {
  kind: "leave" | "remove" | "role";
  members: readonly AuthMemberRow[];
  nextRole?: string;
  targetUserId: string;
}): void {
  if (input.members.length <= 1 && input.kind !== "role") {
    throw AthenaAuthRuntimeError.forbidden(LAST_MEMBER_LEAVE_FORBIDDEN);
  }
  const owners = input.members.filter((member) => member.role === "owner");
  const target = input.members.find(
    (member) => member.user_id === input.targetUserId
  );
  if (target?.role !== "owner") {
    return;
  }
  if (owners.length > 1) {
    return;
  }
  if (input.kind === "role" && input.nextRole === "owner") {
    return;
  }
  if (input.kind === "leave") {
    throw AthenaAuthRuntimeError.forbidden(LAST_OWNER_LEAVE_FORBIDDEN);
  }
  if (input.kind === "role") {
    throw AthenaAuthRuntimeError.forbidden(LAST_OWNER_ROLE_LOCKED);
  }
  throw AthenaAuthRuntimeError.forbidden(LAST_OWNER_REMOVE_FORBIDDEN);
}

export async function normalizeSessionActiveOrganization(
  session: AuthSessionRow,
  stores: {
    getMember(
      organizationId: string,
      userId: string
    ): Promise<AuthMemberRow | undefined>;
    setSessionActiveOrganization(
      token: string,
      organizationId: string | null
    ): Promise<void>;
  }
): Promise<AuthSessionRow> {
  const organizationId = session.active_organization_id;
  if (!organizationId) {
    return session;
  }
  const membership = await stores.getMember(organizationId, session.user_id);
  if (membership) {
    return session;
  }
  await stores.setSessionActiveOrganization(session.token, null);
  return {
    ...session,
    active_organization_id: null,
  };
}
