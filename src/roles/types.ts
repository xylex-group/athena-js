import type { AthenaRightKey } from "../rights/key.ts";
import type { AthenaRoleId } from "./id.ts";
import type { AthenaRoleKey } from "./key.ts";

export const ATHENA_ROLES_IR_KIND = "athena.roles" as const;
export const ATHENA_ROLES_IR_VERSION = 1 as const;

export type AthenaRoleSystemKind = "owner" | "admin" | "member" | null;

export type AthenaRoleDefinitionScope =
  | { kind: "platform" }
  | { kind: "organization-template" }
  | { kind: "organization"; organizationId: string };

export interface AthenaRoleDefinition {
  assignable: boolean;
  description?: string;
  displayName: string;
  id: AthenaRoleId;
  key: AthenaRoleKey;
  protected: boolean;
  rights: readonly AthenaRightKey[];
  scope: AthenaRoleDefinitionScope;
  systemKind: AthenaRoleSystemKind;
}

export interface AthenaRolesMetadata {
  provenance?: readonly string[];
}

export interface AthenaRolesIr {
  irVersion: typeof ATHENA_ROLES_IR_VERSION;
  kind: typeof ATHENA_ROLES_IR_KIND;
  metadata: AthenaRolesMetadata;
  roles: readonly AthenaRoleDefinition[];
}

export interface AthenaRoleSnapshotProjection {
  assignable: boolean;
  assignmentCount: number;
  description?: string;
  displayName: string;
  id: string;
  key: string;
  organizationId: string | null;
  protected: boolean;
  rightCount: number;
  scopeKind: "platform" | "organization";
  systemKind: AthenaRoleSystemKind;
  version: number;
}
