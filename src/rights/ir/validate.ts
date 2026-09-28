import { parseAthenaRightKey } from "../key.ts";
import {
  ATHENA_RIGHTS_IR_KIND,
  ATHENA_RIGHTS_IR_VERSION,
  type AthenaRightDefinition,
  type AthenaRightRiskLevel,
  type AthenaRightScopeKind,
  type AthenaRightsIr,
} from "../types.ts";

export class AthenaRightsIrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AthenaRightsIrValidationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new AthenaRightsIrValidationError(
        `${label} contains unknown field ${key}`
      );
    }
  }
}

function requireEnum<T extends string>(
  value: unknown,
  values: readonly T[],
  label: string
): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new AthenaRightsIrValidationError(`${label} is invalid`);
  }
  return value as T;
}

function validateMetadata(value: unknown): {
  provenance?: string[];
} {
  if (!isRecord(value)) {
    throw new AthenaRightsIrValidationError(
      "Rights IR metadata must be an object"
    );
  }
  rejectUnknownKeys(value, ["provenance"], "metadata");
  if (value.provenance === undefined) {
    return {};
  }
  if (
    !Array.isArray(value.provenance) ||
    value.provenance.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0 ||
        item.length > 128 ||
        item.trim() !== item ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(item)
    )
  ) {
    throw new AthenaRightsIrValidationError(
      "metadata.provenance must contain only strings"
    );
  }
  return { provenance: [...value.provenance] };
}

function validateDefinition(
  value: unknown,
  index: number
): AthenaRightDefinition {
  const label = `rights[${index}]`;
  if (!isRecord(value)) {
    throw new AthenaRightsIrValidationError(`${label} must be an object`);
  }
  rejectUnknownKeys(
    value,
    [
      "assignable",
      "description",
      "displayName",
      "domain",
      "key",
      "riskLevel",
      "scopeKind",
    ],
    label
  );
  if (typeof value.key !== "string") {
    throw new AthenaRightsIrValidationError(`${label}.key is required`);
  }
  const key = parseAthenaRightKey(value.key);
  if (
    typeof value.domain !== "string" ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value.domain)
  ) {
    throw new AthenaRightsIrValidationError(`${label}.domain is invalid`);
  }
  if (
    typeof value.displayName !== "string" ||
    value.displayName.trim().length === 0
  ) {
    throw new AthenaRightsIrValidationError(
      `${label}.displayName must be non-empty`
    );
  }
  if (
    typeof value.description !== "string" ||
    value.description.trim().length === 0
  ) {
    throw new AthenaRightsIrValidationError(
      `${label}.description must be non-empty`
    );
  }
  if (typeof value.assignable !== "boolean") {
    throw new AthenaRightsIrValidationError(
      `${label}.assignable must be a boolean`
    );
  }
  const riskLevel = requireEnum<AthenaRightRiskLevel>(
    value.riskLevel,
    ["low", "elevated", "critical"],
    `${label}.riskLevel`
  );
  const scopeKind = requireEnum<AthenaRightScopeKind>(
    value.scopeKind,
    ["self", "organization", "platform"],
    `${label}.scopeKind`
  );
  return {
    assignable: value.assignable,
    description: value.description,
    displayName: value.displayName,
    domain: value.domain,
    key,
    riskLevel,
    scopeKind,
  };
}

export function validateAthenaRightsIr(value: unknown): AthenaRightsIr {
  if (!isRecord(value)) {
    throw new AthenaRightsIrValidationError("Rights IR must be an object");
  }
  rejectUnknownKeys(
    value,
    ["kind", "irVersion", "metadata", "rights"],
    "document"
  );
  if (value.kind !== ATHENA_RIGHTS_IR_KIND) {
    throw new AthenaRightsIrValidationError("Rights IR kind is invalid");
  }
  if (value.irVersion !== ATHENA_RIGHTS_IR_VERSION) {
    throw new AthenaRightsIrValidationError("Rights IR version is invalid");
  }
  if (!Array.isArray(value.rights)) {
    throw new AthenaRightsIrValidationError(
      "Rights IR rights must be an array"
    );
  }
  const rights = value.rights.map(validateDefinition);
  const keys = new Set<string>();
  for (const definition of rights) {
    if (keys.has(definition.key)) {
      throw new AthenaRightsIrValidationError(
        `duplicate Right key "${definition.key}"`
      );
    }
    keys.add(definition.key);
  }
  const metadata = validateMetadata(value.metadata);
  return {
    irVersion: ATHENA_RIGHTS_IR_VERSION,
    kind: ATHENA_RIGHTS_IR_KIND,
    metadata,
    rights,
  };
}
