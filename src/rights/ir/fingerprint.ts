import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { AthenaRightDefinition } from "../types.ts";
import { canonicalizeAthenaRightsIr } from "./canonicalize.ts";

function semanticDefinition(
  definition: AthenaRightDefinition
): AthenaRightDefinition {
  return {
    assignable: definition.assignable,
    description: definition.description,
    displayName: definition.displayName,
    domain: definition.domain,
    key: definition.key,
    riskLevel: definition.riskLevel,
    scopeKind: definition.scopeKind,
  };
}

export function fingerprintAthenaRightsIr(value: unknown): string {
  const canonical = canonicalizeAthenaRightsIr(value);
  return bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify({
          kind: canonical.kind,
          irVersion: canonical.irVersion,
          rights: canonical.rights.map(semanticDefinition),
        })
      )
    )
  );
}
