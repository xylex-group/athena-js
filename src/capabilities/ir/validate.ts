import {
  ATHENA_CAPABILITIES_IR_KIND,
  ATHENA_CAPABILITIES_IR_VERSION,
  type AthenaCapabilityDomain,
  type AthenaCapabilityEntry,
  type AthenaCapabilityImplementation,
  type AthenaCapabilityKind,
  type AthenaCapabilityMaturity,
  type AthenaCapabilityReasonCode,
  type AthenaCapabilitySourceKind,
  type AthenaCapabilityStatus,
  type AthenaCapabilitiesIr,
} from "../types.ts";
import { parseAthenaCapabilityKey } from "../key.ts";

export class CapabilitiesIrError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilitiesIrError";
  }
}

const DOMAINS = new Set<AthenaCapabilityDomain>([
  "data",
  "auth",
  "storage",
  "billing",
  "chat",
  "notifications",
]);
const KINDS = new Set<AthenaCapabilityKind>([
  "operation",
  "feature",
  "semantic",
]);
const IMPLEMENTATIONS = new Set<AthenaCapabilityImplementation>([
  "native",
  "proxied",
  "emulated",
  "unsupported",
  "unknown",
]);
const STATUSES = new Set<AthenaCapabilityStatus>([
  "available",
  "unavailable",
  "degraded",
  "unknown",
]);
const MATURITIES = new Set<AthenaCapabilityMaturity>([
  "stable",
  "preview",
  "disabled",
]);
const SOURCE_KINDS = new Set<AthenaCapabilitySourceKind>([
  "catalog",
  "runtime-plan",
  "transport",
  "provider",
  "configuration",
  "discovery",
  "runtime",
]);
const GENERIC_REASONS = new Set<AthenaCapabilityReasonCode>([
  "configuration.missing",
  "configuration.invalid",
  "runtime.initializing",
  "runtime.unavailable",
  "transport.unavailable",
  "transport.incompatible",
  "provider.unconfigured",
  "provider.unsupported",
  "provider.operation-unsupported",
  "dependency.unavailable",
  "feature.disabled",
  "capability.unknown",
]);

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
      throw new CapabilitiesIrError(`${label}.${key} is not supported`);
    }
  }
}

function requireEnum<T extends string>(
  value: unknown,
  values: Set<T>,
  label: string
): T {
  if (typeof value !== "string" || !values.has(value as T)) {
    throw new CapabilitiesIrError(`${label} is invalid`);
  }
  return value as T;
}

function validateReason(value: unknown, label: string): void {
  if (!isRecord(value)) {
    throw new CapabilitiesIrError(`${label} must be an object`);
  }
  rejectUnknownKeys(value, ["code"], label);
  const segments =
    typeof value.code === "string" ? value.code.split(".") : [];
  const domainReason =
    segments.length >= 2 &&
    DOMAINS.has(segments[0] as AthenaCapabilityDomain) &&
    segments.slice(1).every((segment) => /^[a-z][a-z0-9-]*$/.test(segment));
  if (
    typeof value.code !== "string" ||
    (!GENERIC_REASONS.has(value.code as AthenaCapabilityReasonCode) &&
      !domainReason)
  ) {
    throw new CapabilitiesIrError(`${label}.code is invalid`);
  }
}

function validateEntry(value: unknown, index: number): AthenaCapabilityEntry {
  const label = `capabilities[${index}]`;
  if (!isRecord(value)) {
    throw new CapabilitiesIrError(`${label} must be an object`);
  }
  rejectUnknownKeys(value, [
    "key",
    "domain",
    "kind",
    "implementation",
    "status",
    "maturity",
    "sources",
    "reason",
  ], label);
  if (typeof value.key !== "string") {
    throw new CapabilitiesIrError(`${label}.key is required`);
  }
  const key = parseAthenaCapabilityKey(value.key);
  const domain = requireEnum(value.domain, DOMAINS, `${label}.domain`);
  if (!key.startsWith(`${domain}.`)) {
    throw new CapabilitiesIrError(`${label}.key does not match its domain`);
  }
  const kind = requireEnum(value.kind, KINDS, `${label}.kind`);
  const implementation = requireEnum(
    value.implementation,
    IMPLEMENTATIONS,
    `${label}.implementation`
  );
  const status = requireEnum(value.status, STATUSES, `${label}.status`);
  const maturity = requireEnum(value.maturity, MATURITIES, `${label}.maturity`);
  if (implementation === "unsupported" && status === "available") {
    throw new CapabilitiesIrError(
      `${label} cannot be unsupported and available`
    );
  }
  if (
    implementation === "unsupported" &&
    status !== "unavailable" &&
    status !== "unknown"
  ) {
    throw new CapabilitiesIrError(
      `${label} unsupported implementation requires unavailable or unknown status`
    );
  }
  if (implementation === "unknown" && status !== "unknown") {
    throw new CapabilitiesIrError(
      `${label} unknown implementation requires unknown status`
    );
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    throw new CapabilitiesIrError(`${label}.sources must be non-empty`);
  }
  const sources = value.sources.map((source, sourceIndex) => {
    const sourceLabel = `${label}.sources[${sourceIndex}]`;
    if (!isRecord(source)) {
      throw new CapabilitiesIrError(`${sourceLabel} must be an object`);
    }
    rejectUnknownKeys(source, ["kind", "source"], sourceLabel);
    const sourceKind = requireEnum(
      source.kind,
      SOURCE_KINDS,
      `${sourceLabel}.kind`
    );
    if (typeof source.source !== "string" || source.source.length === 0) {
      throw new CapabilitiesIrError(`${sourceLabel}.source is required`);
    }
    if (
      !/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?(?:\/[a-z][a-z0-9-]*)*$/.test(
        source.source
      )
    ) {
      throw new CapabilitiesIrError(`${sourceLabel}.source is not safe`);
    }
    return { kind: sourceKind, source: source.source };
  });
  if (value.reason !== undefined) {
    validateReason(value.reason, `${label}.reason`);
  }
  return {
    key,
    domain,
    kind,
    implementation,
    status,
    maturity,
    sources,
    ...(value.reason ? { reason: value.reason as AthenaCapabilityEntry["reason"] } : {}),
  };
}

export function validateAthenaCapabilitiesIr(
  value: unknown
): AthenaCapabilitiesIr {
  if (!isRecord(value)) {
    throw new CapabilitiesIrError("Capabilities IR must be an object");
  }
  rejectUnknownKeys(value, ["kind", "irVersion", "capabilities", "metadata"], "document");
  if (value.kind !== ATHENA_CAPABILITIES_IR_KIND) {
    throw new CapabilitiesIrError("Capabilities IR kind is invalid");
  }
  if (value.irVersion !== ATHENA_CAPABILITIES_IR_VERSION) {
    throw new CapabilitiesIrError("Capabilities IR version is invalid");
  }
  if (!Array.isArray(value.capabilities)) {
    throw new CapabilitiesIrError("Capabilities IR capabilities must be an array");
  }
  const keys = new Set<string>();
  const capabilities = value.capabilities.map((entry, index) => {
    const validated = validateEntry(entry, index);
    if (keys.has(validated.key)) {
      throw new CapabilitiesIrError(`Duplicate capability key "${validated.key}"`);
    }
    keys.add(validated.key);
    return validated;
  });
  if (!isRecord(value.metadata)) {
    throw new CapabilitiesIrError("Capabilities IR metadata must be an object");
  }
  rejectUnknownKeys(value.metadata, ["generatedAt", "provenance"], "metadata");
  if (
    value.metadata.generatedAt !== undefined &&
    typeof value.metadata.generatedAt !== "string"
  ) {
    throw new CapabilitiesIrError("metadata.generatedAt must be a string");
  }
  if (
    value.metadata.provenance !== undefined &&
    (!Array.isArray(value.metadata.provenance) ||
      value.metadata.provenance.some(
        (item) =>
          typeof item !== "string" ||
          !/^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)?(?:\/[a-z][a-z0-9-]*)*$/.test(
            item
          )
      ))
  ) {
    throw new CapabilitiesIrError("metadata.provenance must be string[]");
  }
  return {
    kind: ATHENA_CAPABILITIES_IR_KIND,
    irVersion: ATHENA_CAPABILITIES_IR_VERSION,
    capabilities,
    metadata: value.metadata,
  };
}
