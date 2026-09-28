import type {
  AthenaCapabilitiesIr,
  AthenaCapabilityEntry,
  AthenaCapabilitySource,
} from "../types.ts";
import { athenaCapabilityKeyString } from "../key.ts";
import { validateAthenaCapabilitiesIr } from "./validate.ts";

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function canonicalSources(
  sources: readonly AthenaCapabilitySource[]
): AthenaCapabilitySource[] {
  const unique = new Map(
    sources.map((source) => [`${source.kind}\0${source.source}`, source])
  );
  return [...unique.values()].sort(
    (a, b) =>
      compareStrings(a.kind, b.kind) || compareStrings(a.source, b.source)
  );
}

function canonicalEntry(entry: AthenaCapabilityEntry): AthenaCapabilityEntry {
  return {
    ...entry,
    sources: canonicalSources(entry.sources),
  };
}

export function canonicalizeAthenaCapabilitiesIr(
  value: unknown
): AthenaCapabilitiesIr {
  const validated = validateAthenaCapabilitiesIr(value);
  const metadata = validated.metadata;
  return {
    kind: validated.kind,
    irVersion: validated.irVersion,
    capabilities: [...validated.capabilities]
      .map(canonicalEntry)
      .sort((a, b) =>
        compareStrings(
          athenaCapabilityKeyString(a.key),
          athenaCapabilityKeyString(b.key)
        )
      ),
    metadata: {
      ...(metadata.generatedAt === undefined
        ? {}
        : { generatedAt: metadata.generatedAt }),
      ...(metadata.provenance === undefined
        ? {}
        : {
            provenance: [...new Set(metadata.provenance)].sort(compareStrings),
          }),
    },
  };
}
