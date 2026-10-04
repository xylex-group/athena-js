import { createAthenaRightsAuthority } from "../../../rights/authority.ts";
import { canonicalizeAthenaRightsIr } from "../../../rights/ir/canonicalize.ts";
import { fingerprintAthenaRightsIr } from "../../../rights/ir/fingerprint.ts";
import { parseAthenaRoleId } from "../../../roles/id.ts";
import { canonicalizeAthenaRolesIr } from "../../../roles/ir/canonicalize.ts";
import { canonicalGrantId } from "../grant-identity.ts";
import { AthenaAuthorizationSnapshotIrValidationError } from "./errors.ts";
import {
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND,
  ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION,
  type AthenaAuthorizationSnapshotAssignment,
  type AthenaAuthorizationSnapshotIr,
  type AthenaAuthorizationSnapshotScope,
  type AthenaAuthorizationSnapshotSubject,
} from "./types.ts";

function invalid(message: string): never {
  throw new AthenaAuthorizationSnapshotIrValidationError(message);
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

function identity(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  ) {
    invalid(`${path} must be a non-empty canonical identity`);
  }
  return value;
}

function timestamp(value: unknown, path: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value
    )
  ) {
    invalid(`${path} must be an RFC3339 timestamp`);
  }
  const [datePart, timePart] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute, second] = timePart
    .split(/[Z+-]/, 1)[0]
    .split(/[:.]/)
    .map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  const parsed = Date.parse(value);
  if (
    !Number.isFinite(parsed) ||
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    invalid(`${path} must be a valid RFC3339 timestamp`);
  }
  return new Date(parsed).toISOString();
}

function parseScope(value: unknown): AthenaAuthorizationSnapshotScope {
  if (!isRecord(value)) {
    invalid("scope must be an object");
  }
  if (value.kind === "platform") {
    exactKeys(value, ["kind"], "scope");
    return { kind: "platform" };
  }
  if (value.kind === "organization") {
    exactKeys(value, ["kind", "organizationId"], "scope");
    const organizationId = identity(
      value.organizationId,
      "scope.organizationId"
    );
    return { kind: "organization", organizationId };
  }
  invalid("scope.kind is invalid");
}

function parseSubject(
  value: unknown,
  path: string
): AthenaAuthorizationSnapshotSubject {
  if (!isRecord(value)) {
    invalid(`${path} must be an object`);
  }
  if (value.kind === "user") {
    exactKeys(value, ["kind", "userId"], path);
    return { kind: "user", userId: identity(value.userId, `${path}.userId`) };
  }
  if (value.kind === "member") {
    exactKeys(value, ["kind", "memberId", "userId"], path);
    return {
      kind: "member",
      memberId: identity(value.memberId, `${path}.memberId`),
      userId: identity(value.userId, `${path}.userId`),
    };
  }
  invalid(`${path}.kind is invalid`);
}

function parseAssignment(
  value: unknown,
  index: number
): AthenaAuthorizationSnapshotAssignment {
  const path = `assignments[${index}]`;
  if (!isRecord(value)) {
    invalid(`${path} must be an object`);
  }
  exactKeys(value, ["id", "subject", "roleId", "provenance"], path);
  const id = identity(value.id, `${path}.id`);
  if (typeof value.roleId !== "string") {
    invalid(`${path}.roleId must be a string`);
  }
  const roleId = parseAthenaRoleId(value.roleId);
  if (roleId !== value.roleId) {
    invalid(`${path}.roleId must be canonical`);
  }
  if (!isRecord(value.provenance)) {
    invalid(`${path}.provenance must be an object`);
  }
  exactKeys(
    value.provenance,
    ["assignedAt", "assignedBy", "sourceKind", "sourceId"],
    `${path}.provenance`
  );
  const assignedAt = timestamp(
    value.provenance.assignedAt,
    `${path}.provenance.assignedAt`
  );
  const assignedBy = value.provenance.assignedBy;
  if (assignedBy !== null) {
    identity(assignedBy, `${path}.provenance.assignedBy`);
  }
  const hasSourceKind = Object.hasOwn(value.provenance, "sourceKind");
  const hasSourceId = Object.hasOwn(value.provenance, "sourceId");
  if (hasSourceKind !== hasSourceId) {
    invalid(
      `${path}.provenance sourceKind and sourceId must be provided together`
    );
  }
  if (hasSourceKind && value.provenance.sourceKind !== "identity_connection") {
    invalid(`${path}.provenance.sourceKind is invalid`);
  }
  const sourceId = hasSourceId
    ? identity(value.provenance.sourceId, `${path}.provenance.sourceId`)
    : undefined;
  return {
    id,
    provenance: {
      assignedAt,
      assignedBy: assignedBy as string | null,
      ...(hasSourceKind
        ? { sourceId, sourceKind: "identity_connection" as const }
        : {}),
    },
    roleId,
    subject: parseSubject(value.subject, `${path}.subject`),
  };
}

function parseMetadata(
  value: unknown
): AthenaAuthorizationSnapshotIr["metadata"] {
  if (!isRecord(value)) {
    invalid("metadata must be an object");
  }
  exactKeys(
    value,
    [
      "capturedAt",
      "assignmentRevision",
      "catalogVersion",
      "rightsFingerprint",
      "rolesFingerprint",
      "provenance",
    ],
    "metadata"
  );
  const capturedAt = timestamp(value.capturedAt, "metadata.capturedAt");
  for (const name of ["assignmentRevision", "catalogVersion"] as const) {
    const number = value[name];
    if (
      typeof number !== "number" ||
      !Number.isSafeInteger(number) ||
      number < 1
    ) {
      invalid(`metadata.${name} must be a safe integer >= 1`);
    }
  }
  for (const name of ["rightsFingerprint", "rolesFingerprint"] as const) {
    if (
      typeof value[name] !== "string" ||
      !/^[0-9a-f]{64}$/.test(value[name] as string)
    ) {
      invalid(`metadata.${name} must be a lowercase SHA-256 fingerprint`);
    }
  }
  const hasProvenance = Object.hasOwn(value, "provenance");
  if (
    hasProvenance &&
    (!Array.isArray(value.provenance) ||
      value.provenance.some(
        (entry) =>
          typeof entry !== "string" ||
          entry.length === 0 ||
          entry.length > 128 ||
          entry.trim() !== entry ||
          !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(entry)
      ))
  ) {
    invalid("metadata.provenance must contain unique safe strings");
  }
  if (
    Array.isArray(value.provenance) &&
    new Set(value.provenance).size !== value.provenance.length
  ) {
    invalid("metadata.provenance must contain unique safe strings");
  }
  return {
    assignmentRevision: value.assignmentRevision as number,
    capturedAt,
    catalogVersion: value.catalogVersion as number,
    rightsFingerprint: value.rightsFingerprint as string,
    rolesFingerprint: value.rolesFingerprint as string,
    ...(hasProvenance ? { provenance: value.provenance as string[] } : {}),
  };
}

export function validateAthenaAuthorizationSnapshotIr(
  value: unknown
): AthenaAuthorizationSnapshotIr {
  if (!isRecord(value)) {
    invalid("Authorization Snapshot IR must be an object");
  }
  exactKeys(
    value,
    [
      "kind",
      "irVersion",
      "scope",
      "rights",
      "roles",
      "assignments",
      "metadata",
    ],
    "document"
  );
  if (value.kind !== ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND) {
    invalid("Authorization Snapshot IR kind is invalid");
  }
  if (value.irVersion !== ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION) {
    invalid("Authorization Snapshot IR version is invalid");
  }
  const scope = parseScope(value.scope);
  const rights = canonicalizeAthenaRightsIr(value.rights);
  const rightsAuthority = createAthenaRightsAuthority(rights);
  const roles = canonicalizeAthenaRolesIr(
    value.roles as never,
    rightsAuthority
  );
  if (!Array.isArray(value.assignments)) {
    invalid("assignments must be an array");
  }
  const assignments = value.assignments.map(parseAssignment);
  const rolesById = new Map(roles.roles.map((role) => [role.id, role]));
  const ids = new Set<string>();
  const assignmentKeys = new Set<string>();
  for (const [index, assignment] of assignments.entries()) {
    if (ids.has(assignment.id)) {
      invalid(`duplicate assignment ID ${assignment.id}`);
    }
    ids.add(assignment.id);
    const role = rolesById.get(assignment.roleId);
    if (!role) {
      invalid(`assignments[${index}].roleId does not reference snapshot.roles`);
    }
    if (!role.assignable) {
      invalid(`assignments[${index}] references a non-assignable role`);
    }
    if (scope.kind === "platform") {
      if (
        assignment.subject.kind !== "user" ||
        role.scope.kind !== "platform"
      ) {
        invalid(`assignments[${index}] does not match platform scope`);
      }
    } else if (
      assignment.subject.kind !== "member" ||
      (role.scope.kind !== "organization-template" &&
        !(
          role.scope.kind === "organization" &&
          role.scope.organizationId === scope.organizationId
        ))
    ) {
      invalid(`assignments[${index}] does not match organization scope`);
    }
    if (scope.kind === "platform" && role.scope.kind !== "platform") {
      invalid(`roles[${role.id}] does not match platform scope`);
    }
    if (
      scope.kind === "organization" &&
      role.scope.kind === "organization" &&
      role.scope.organizationId !== scope.organizationId
    ) {
      invalid(`roles[${role.id}] belongs to another organization`);
    }
    if (scope.kind === "organization" && role.scope.kind === "platform") {
      invalid(`roles[${role.id}] does not match organization scope`);
    }
    if (
      assignment.provenance.sourceKind !== undefined &&
      scope.kind !== "organization"
    ) {
      invalid(
        `assignments[${index}] identity-connection provenance requires organization scope`
      );
    }
    const subjectId =
      assignment.subject.kind === "user"
        ? assignment.subject.userId
        : assignment.subject.memberId;
    const expectedId = canonicalGrantId({
      organizationId:
        scope.kind === "organization" ? scope.organizationId : null,
      roleId: assignment.roleId,
      scopeKind: scope.kind,
      subjectId,
      subjectKind: assignment.subject.kind,
    });
    if (assignment.id !== expectedId) {
      invalid(`assignments[${index}].id is not canonical`);
    }
    const duplicateKey = `${assignment.subject.kind}:${subjectId}:${assignment.roleId}`;
    if (assignmentKeys.has(duplicateKey)) {
      invalid(`duplicate assignment ${duplicateKey}`);
    }
    assignmentKeys.add(duplicateKey);
  }
  for (const role of roles.roles) {
    if (scope.kind === "platform" && role.scope.kind !== "platform") {
      invalid(`role ${role.id} does not match platform scope`);
    }
    if (scope.kind === "organization" && role.scope.kind === "platform") {
      invalid(`role ${role.id} does not match organization scope`);
    }
    if (
      scope.kind === "organization" &&
      role.scope.kind === "organization" &&
      role.scope.organizationId !== scope.organizationId
    ) {
      invalid(`role ${role.id} belongs to another organization`);
    }
  }
  const metadata = parseMetadata(value.metadata);
  if (metadata.rightsFingerprint !== fingerprintAthenaRightsIr(rights)) {
    invalid("metadata.rightsFingerprint does not match the embedded rights IR");
  }
  return {
    assignments,
    irVersion: ATHENA_AUTHORIZATION_SNAPSHOT_IR_VERSION,
    kind: ATHENA_AUTHORIZATION_SNAPSHOT_IR_KIND,
    metadata,
    rights,
    roles,
    scope,
  };
}
