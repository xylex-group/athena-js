import type { AthenaRightContribution } from "./contribution.ts";
import { canonicalizeAthenaRightsIr } from "./ir/canonicalize.ts";
import { athenaRightKeyString, parseAthenaRightKey } from "./key.ts";
import type {
  AthenaRightDefinition,
  AthenaRightsIr,
  AthenaRightsMetadata,
} from "./types.ts";
import { ATHENA_RIGHTS_IR_KIND, ATHENA_RIGHTS_IR_VERSION } from "./types.ts";

function semanticDefinition(definition: AthenaRightDefinition): string {
  return JSON.stringify({
    assignable: definition.assignable,
    description: definition.description,
    displayName: definition.displayName,
    domain: definition.domain,
    key: athenaRightKeyString(definition.key),
    riskLevel: definition.riskLevel,
    scopeKind: definition.scopeKind,
  });
}

export function resolveAthenaRightsIr(
  contributions: readonly AthenaRightContribution[],
  metadata: AthenaRightsMetadata = {}
): AthenaRightsIr {
  const definitions = new Map<
    string,
    { definition: AthenaRightDefinition; sources: Set<string> }
  >();

  for (const contribution of contributions) {
    if (
      contribution.source.length === 0 ||
      contribution.source.length > 128 ||
      contribution.source.trim() !== contribution.source ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(contribution.source)
    ) {
      throw new Error(
        `Invalid Right contribution source "${contribution.source}"`
      );
    }
    const key = parseAthenaRightKey(
      athenaRightKeyString(contribution.definition.key)
    );
    const definition = { ...contribution.definition, key };
    const current = definitions.get(key);
    if (!current) {
      definitions.set(key, {
        definition,
        sources: new Set([contribution.source]),
      });
      continue;
    }
    if (
      semanticDefinition(current.definition) !== semanticDefinition(definition)
    ) {
      throw new Error(`Conflicting Right contributions for "${key}"`);
    }
    current.sources.add(contribution.source);
  }

  return canonicalizeAthenaRightsIr({
    irVersion: ATHENA_RIGHTS_IR_VERSION,
    kind: ATHENA_RIGHTS_IR_KIND,
    metadata: {
      provenance: [
        ...(metadata.provenance ?? []),
        ...[...definitions.values()].flatMap(({ sources }) => [...sources]),
      ],
    },
    rights: [...definitions.values()].map(({ definition }) => definition),
  });
}
