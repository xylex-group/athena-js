import { parseAthenaCapabilityKey } from "./key.ts";
import type {
  AthenaCapabilityDomain,
  AthenaCapabilityImplementation,
  AthenaCapabilityKind,
  AthenaCapabilityMaturity,
  AthenaCapabilityReason,
  AthenaCapabilitySource,
  AthenaCapabilityStatus,
} from "./types.ts";
import type { AthenaCapabilityContribution } from "./resolver.ts";

export function capabilityContribution(
  input: {
    key: string;
    domain: AthenaCapabilityDomain;
    kind: AthenaCapabilityKind;
    implementation?: AthenaCapabilityImplementation;
    status?: AthenaCapabilityStatus;
    maturity?: AthenaCapabilityMaturity;
    reason?: AthenaCapabilityReason;
  },
  source: AthenaCapabilitySource
): AthenaCapabilityContribution {
  return {
    key: parseAthenaCapabilityKey(input.key),
    domain: input.domain,
    kind: input.kind,
    implementation: input.implementation ?? "native",
    status: input.status ?? "available",
    maturity: input.maturity ?? "stable",
    source,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

export function unsupportedCapabilityContribution(
  input: {
    key: string;
    domain: AthenaCapabilityDomain;
    kind: AthenaCapabilityKind;
  },
  source: AthenaCapabilitySource
): AthenaCapabilityContribution {
  return capabilityContribution(
    {
      key: input.key,
      domain: input.domain,
      kind: input.kind,
      implementation: "unsupported",
      status: "unavailable",
      maturity: "stable",
      reason: { code: "provider.unsupported" },
    },
    source
  );
}

export function unconfiguredCapabilityContribution(
  input: {
    key: string;
    domain: AthenaCapabilityDomain;
    kind: AthenaCapabilityKind;
  },
  source: AthenaCapabilitySource
): AthenaCapabilityContribution {
  return capabilityContribution(
    {
      key: input.key,
      domain: input.domain,
      kind: input.kind,
      implementation: "native",
      status: "unavailable",
      maturity: "stable",
      reason: { code: "provider.unconfigured" },
    },
    source
  );
}

export function unknownCapabilityContribution(
  input: {
    key: string;
    domain: AthenaCapabilityDomain;
    kind: AthenaCapabilityKind;
  },
  source: AthenaCapabilitySource
): AthenaCapabilityContribution {
  return capabilityContribution(
    {
      key: input.key,
      domain: input.domain,
      kind: input.kind,
      implementation: "unknown",
      status: "unknown",
      maturity: "stable",
      reason: { code: "capability.unknown" },
    },
    source
  );
}

export function disabledCapabilityContribution(
  input: {
    key: string;
    domain: AthenaCapabilityDomain;
    kind: AthenaCapabilityKind;
  },
  source: AthenaCapabilitySource
): AthenaCapabilityContribution {
  return capabilityContribution(
    {
      key: input.key,
      domain: input.domain,
      kind: input.kind,
      implementation: "native",
      status: "unavailable",
      maturity: "disabled",
      reason: { code: "feature.disabled" },
    },
    source
  );
}
