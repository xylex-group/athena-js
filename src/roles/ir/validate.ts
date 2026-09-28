import type { AthenaRightsAuthority } from "../../rights/authority.ts";
import { getAthenaAuthorizationRightsAuthority } from "../../runtime/authorization/catalog.ts";
import { parseAthenaRightKey } from "../../rights/key.ts";
import { AthenaRolesIrValidationError } from "../errors.ts";
import { parseAthenaRoleId } from "../id.ts";
import { parseAthenaRoleKey } from "../key.ts";
import {
  ATHENA_ROLES_IR_KIND,
  ATHENA_ROLES_IR_VERSION,
  type AthenaRoleDefinition,
  type AthenaRoleDefinitionScope,
  type AthenaRolesIr,
} from "../types.ts";

function invalid(message: string): never {
  throw new AthenaRolesIrValidationError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string
): void {
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      invalid(`${path} contains unknown field ${key}`);
    }
  }
}

function parseScope(value: unknown, path: string): AthenaRoleDefinitionScope {
  if (!isRecord(value)) {
    invalid(`${path} must be an object`);
  }
  if (value.kind === "platform" || value.kind === "organization-template") {
    if (Object.keys(value).length !== 1) {
      invalid(`${path} has fields that do not belong to ${value.kind}`);
    }
    return { kind: value.kind };
  }
  if (
    value.kind === "organization" &&
    typeof value.organizationId === "string" &&
    value.organizationId.trim().length > 0 &&
    Object.keys(value).length === 2
  ) {
    return { kind: "organization", organizationId: value.organizationId };
  }
  invalid(`${path} is not a valid role scope`);
}

function validateRole(
  value: unknown,
  index: number,
  rightsAuthority: AthenaRightsAuthority
): AthenaRoleDefinition {
  const path = `roles[${index}]`;
  if (!isRecord(value)) {
    invalid(`${path} must be an object`);
  }
  exactKeys(
    value,
    [
      "id",
      "key",
      "displayName",
      "description",
      "scope",
      "assignable",
      "protected",
      "systemKind",
      "rights",
    ],
    path
  );
  if (typeof value.id !== "string" || typeof value.key !== "string") {
    invalid(`${path}.id and ${path}.key must be strings`);
  }
  const id = parseAthenaRoleId(value.id);
  const key = parseAthenaRoleKey(value.key);
  if (typeof value.displayName !== "string" || value.displayName.length === 0) {
    invalid(`${path}.displayName must be non-empty`);
  }
  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    invalid(`${path}.description must be a string when present`);
  }
  if (
    typeof value.assignable !== "boolean" ||
    typeof value.protected !== "boolean"
  ) {
    invalid(`${path}.assignable and ${path}.protected must be booleans`);
  }
  if (
    value.systemKind !== null &&
    value.systemKind !== "owner" &&
    value.systemKind !== "admin" &&
    value.systemKind !== "member"
  ) {
    invalid(`${path}.systemKind is invalid`);
  }
  const scope = parseScope(value.scope, `${path}.scope`);
  if (!Array.isArray(value.rights)) {
    invalid(`${path}.rights must be an array`);
  }
  const rights = value.rights.map((right, rightIndex) => {
    if (typeof right !== "string") {
      invalid(`${path}.rights[${rightIndex}] must be a string`);
    }
    const parsed = parseAthenaRightKey(right);
    const definition = rightsAuthority.byKey.get(parsed);
    if (!definition) {
      invalid(
        `${path}.rights[${rightIndex}] is not in the installed Rights catalog`
      );
    }
    if (!definition.assignable) {
      invalid(`${path}.rights[${rightIndex}] is not assignable`);
    }
    if (
      definition.scopeKind !== "self" &&
      ((scope.kind === "platform" && definition.scopeKind !== "platform") ||
        (scope.kind !== "platform" && definition.scopeKind !== "organization"))
    ) {
      invalid(`${path}.rights[${rightIndex}] is incompatible with role scope`);
    }
    return parsed;
  });
  if (new Set(rights).size !== rights.length) {
    invalid(`${path}.rights contains duplicates`);
  }
  if (scope.kind === "organization" && value.systemKind !== null) {
    invalid(`${path}.organization roles cannot carry a system classification`);
  }
  if (
    scope.kind === "organization-template" &&
    (!(value.assignable && value.protected) || value.systemKind === null)
  ) {
    invalid(
      `${path}.organization-template violates frozen template invariants`
    );
  }
  return {
    displayName: value.displayName,
    id,
    key,
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    assignable: value.assignable,
    protected: value.protected,
    rights,
    scope,
    systemKind: value.systemKind,
  };
}

export function validateAthenaRolesIr(
  value: unknown,
  rightsAuthority = getAthenaAuthorizationRightsAuthority()
): asserts value is AthenaRolesIr {
  if (!isRecord(value)) {
    invalid("Roles IR must be an object");
  }
  exactKeys(value, ["kind", "irVersion", "roles", "metadata"], "document");
  if (value.kind !== ATHENA_ROLES_IR_KIND) {
    invalid("Roles IR kind is invalid");
  }
  if (value.irVersion !== ATHENA_ROLES_IR_VERSION) {
    invalid("Roles IR version is invalid");
  }
  if (!Array.isArray(value.roles)) {
    invalid("Roles IR roles must be an array");
  }
  if (!isRecord(value.metadata)) {
    invalid("Roles IR metadata must be an object");
  }
  exactKeys(value.metadata, ["provenance"], "metadata");
  if (
    value.metadata.provenance !== undefined &&
    (!Array.isArray(value.metadata.provenance) ||
      value.metadata.provenance.some((entry) => typeof entry !== "string"))
  ) {
    invalid("metadata.provenance must contain only strings");
  }
  const roles = value.roles.map((entry, index) =>
    validateRole(entry, index, rightsAuthority)
  );
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const entry of roles) {
    if (ids.has(entry.id)) {
      invalid(`duplicate role ID ${entry.id}`);
    }
    if (keys.has(entry.key)) {
      invalid(`duplicate role key ${entry.key}`);
    }
    ids.add(entry.id);
    keys.add(entry.key);
  }
}
