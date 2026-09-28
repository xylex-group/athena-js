import {
  athenaCapabilityKeyString,
  parseAthenaCapabilityKey,
  type AthenaCapabilityKey,
} from "./key.ts";
import {
  ATHENA_CAPABILITIES_IR_KIND,
  ATHENA_CAPABILITIES_IR_VERSION,
  type AthenaCapabilitiesMetadata,
  type AthenaCapabilityEntry,
  type AthenaCapabilitySource,
  type AthenaCapabilitiesIr,
  type AthenaCapabilityReason,
} from "./types.ts";
import { canonicalizeAthenaCapabilitiesIr } from "./ir/canonicalize.ts";

export interface AthenaCapabilityContribution
  extends Omit<AthenaCapabilityEntry, "key" | "sources"> {
  key: AthenaCapabilityKey;
  source: AthenaCapabilitySource;
}

function semanticPart(entry: AthenaCapabilityContribution): string {
  return JSON.stringify({
    domain: entry.domain,
    implementation: entry.implementation,
    kind: entry.kind,
    maturity: entry.maturity,
    reason: entry.reason ?? null,
    status: entry.status,
  });
}

export function resolveAthenaCapabilities(
  contributions: readonly AthenaCapabilityContribution[],
  metadata: AthenaCapabilitiesMetadata = {}
): AthenaCapabilitiesIr {
  const entries = new Map<
    string,
    { contribution: AthenaCapabilityContribution; sources: AthenaCapabilitySource[] }
  >();
  for (const contribution of contributions) {
    const key = parseAthenaCapabilityKey(
      athenaCapabilityKeyString(contribution.key)
    );
    const current = entries.get(key);
    if (!current) {
      entries.set(key, { contribution: { ...contribution, key }, sources: [contribution.source] });
      continue;
    }
    if (semanticPart(current.contribution) !== semanticPart(contribution)) {
      throw new Error(`Conflicting capability contributions for "${key}"`);
    }
    if (
      !current.sources.some(
        (source) =>
          source.kind === contribution.source.kind &&
          source.source === contribution.source.source
      )
    ) {
      current.sources.push(contribution.source);
    }
  }
  return canonicalizeAthenaCapabilitiesIr({
    kind: ATHENA_CAPABILITIES_IR_KIND,
    irVersion: ATHENA_CAPABILITIES_IR_VERSION,
    capabilities: [...entries.values()].map(({ contribution, sources }) => ({
      key: contribution.key,
      domain: contribution.domain,
      kind: contribution.kind,
      implementation: contribution.implementation,
      status: contribution.status,
      maturity: contribution.maturity,
      sources,
      ...(contribution.reason
        ? { reason: contribution.reason as AthenaCapabilityReason }
        : {}),
    })),
    metadata,
  });
}
