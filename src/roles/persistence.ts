import type { AthenaRightsAuthority } from "../rights/authority.ts";
import { AthenaRightKeyError } from "../rights/errors.ts";
import { parseAthenaRightKey } from "../rights/key.ts";
import {
  AthenaRoleIdentityError,
  AthenaRolesIrValidationError,
} from "./errors.ts";
import { parseAthenaRoleId } from "./id.ts";
import { validateAthenaRolesIr } from "./ir/validate.ts";
import { parseAthenaRoleKey } from "./key.ts";
import type { AthenaRoleDefinition } from "./types.ts";

type PersistedRoleRecord = {
  assignable: boolean;
  id: string;
  key: string;
  name: string;
  organizationId: string | null;
  protected: boolean;
  scopeKind: "platform" | "organization";
  systemKind: "owner" | "admin" | "member" | null;
};

export function hydrateAthenaRoleDefinition(
  input: {
    record: PersistedRoleRecord;
    rights: readonly string[];
  },
  rightsAuthority?: AthenaRightsAuthority
): AthenaRoleDefinition {
  const { record } = input;
  if (record.scopeKind === "platform" && record.organizationId !== null) {
    throw new AthenaRolesIrValidationError(
      "Platform role persistence state cannot contain an organization ID"
    );
  }
  const scope =
    record.scopeKind === "platform"
      ? ({ kind: "platform" } as const)
      : record.organizationId === null
        ? ({ kind: "organization-template" } as const)
        : ({
          kind: "organization",
          organizationId: record.organizationId,
        } as const);
  const definition: AthenaRoleDefinition = {
    assignable: record.assignable,
    displayName: record.name,
    id: parseAthenaRoleId(record.id),
    key: parseAthenaRoleKey(record.key),
    protected: record.protected,
    rights: input.rights.map((right) => parseAthenaRightKey(right)),
    scope,
    systemKind: record.systemKind,
  };
  validateAthenaRolesIr(
    {
      irVersion: 1,
      kind: "athena.roles",
      metadata: {},
      roles: [definition],
    },
    rightsAuthority
  );
  return definition;
}

export function tryHydrateAthenaRoleDefinition(
  input: {
    record: PersistedRoleRecord;
    rights: readonly string[];
  },
  rightsAuthority?: AthenaRightsAuthority
): AthenaRoleDefinition | undefined {
  try {
    return hydrateAthenaRoleDefinition(input, rightsAuthority);
  } catch (error) {
    if (
      error instanceof AthenaRoleIdentityError ||
      error instanceof AthenaRolesIrValidationError ||
      error instanceof AthenaRightKeyError
    ) {
      return;
    }
    throw error;
  }
}
