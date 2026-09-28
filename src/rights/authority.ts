import type { AthenaRightKey } from "./key.ts";
import type { AthenaRightDefinition, AthenaRightsIr } from "./types.ts";

export interface AthenaRightsAuthority {
  readonly byKey: ReadonlyMap<AthenaRightKey, AthenaRightDefinition>;
  readonly document: AthenaRightsIr;
}

export function createAthenaRightsAuthority(
  document: AthenaRightsIr
): AthenaRightsAuthority {
  return {
    byKey: new Map(
      document.rights.map((definition) => [definition.key, definition])
    ),
    document,
  };
}
