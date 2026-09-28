import { parseAthenaRightKey } from "../key.ts";
import type { AthenaRightDefinition, AthenaRightsIr } from "../types.ts";
import { validateAthenaRightsIr } from "./validate.ts";

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalDefinition(
  definition: AthenaRightDefinition
): AthenaRightDefinition {
  return {
    ...definition,
    key: parseAthenaRightKey(definition.key),
  };
}

export function canonicalizeAthenaRightsIr(value: unknown): AthenaRightsIr {
  const validated = validateAthenaRightsIr(value);
  const provenance = [...new Set(validated.metadata.provenance ?? [])].sort(
    compareStrings
  );
  return {
    kind: validated.kind,
    irVersion: validated.irVersion,
    metadata: provenance.length === 0 ? {} : { provenance },
    rights: [...validated.rights]
      .map(canonicalDefinition)
      .sort((left, right) => compareStrings(left.key, right.key)),
  };
}
