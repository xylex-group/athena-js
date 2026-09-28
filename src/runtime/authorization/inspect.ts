import type { AthenaRightKey } from "../../rights/key.ts";
import type { AthenaAuthorizationRoleRecord } from "./types.ts";

export type AthenaAuthorizationInspectAssignment = {
  memberId: string | null;
  organizationId: string | null;
  roleId: string;
  roleKey: string;
  scopeKind: "platform" | "organization";
  userId: string | null;
};

export type AthenaAuthorizationInspectRole = AthenaAuthorizationRoleRecord & {
  assignmentCount: number;
  rightCount: number;
  rights: readonly AthenaRightKey[];
};

export type AthenaAuthorizationInspectAudit = {
  action: string;
  actorUserId: string | null;
  createdAt: string | null;
  organizationId: string | null;
  targetId: string | null;
  targetKind: string | null;
};

export type AthenaAuthorizationInspectGraph = {
  assignments: readonly AthenaAuthorizationInspectAssignment[];
  audit: readonly AthenaAuthorizationInspectAudit[];
  revision: number;
  roles: readonly AthenaAuthorizationInspectRole[];
};
