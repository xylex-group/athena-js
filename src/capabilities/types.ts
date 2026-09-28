import type { AthenaCapabilityKey } from "./key.ts";

export const ATHENA_CAPABILITIES_IR_KIND = "athena.capabilities" as const;
export const ATHENA_CAPABILITIES_IR_VERSION = 1 as const;

export type AthenaCapabilityDomain =
  | "data"
  | "auth"
  | "storage"
  | "billing"
  | "chat"
  | "notifications";

export type AthenaCapabilityKind = "operation" | "feature" | "semantic";

export type AthenaCapabilityImplementation =
  | "native"
  | "proxied"
  | "emulated"
  | "unsupported"
  | "unknown";

export type AthenaCapabilityStatus =
  | "available"
  | "unavailable"
  | "degraded"
  | "unknown";

export type AthenaCapabilityMaturity = "stable" | "preview" | "disabled";

export type AthenaCapabilitySourceKind =
  | "catalog"
  | "runtime-plan"
  | "transport"
  | "provider"
  | "configuration"
  | "discovery"
  | "runtime";

export type AthenaCapabilityReasonCode =
  | "configuration.missing"
  | "configuration.invalid"
  | "runtime.initializing"
  | "runtime.unavailable"
  | "transport.unavailable"
  | "transport.incompatible"
  | "provider.unconfigured"
  | "provider.unsupported"
  | "provider.operation-unsupported"
  | "dependency.unavailable"
  | "feature.disabled"
  | "capability.unknown"
  | `${AthenaCapabilityDomain}.${string}`;

export interface AthenaCapabilitySource {
  kind: AthenaCapabilitySourceKind;
  source: string;
}

export interface AthenaCapabilityReason {
  code: AthenaCapabilityReasonCode;
}

export interface AthenaCapabilityEntry {
  key: AthenaCapabilityKey;
  domain: AthenaCapabilityDomain;
  kind: AthenaCapabilityKind;
  implementation: AthenaCapabilityImplementation;
  status: AthenaCapabilityStatus;
  maturity: AthenaCapabilityMaturity;
  sources: readonly AthenaCapabilitySource[];
  reason?: AthenaCapabilityReason;
}

export interface AthenaCapabilitiesMetadata {
  generatedAt?: string;
  provenance?: readonly string[];
}

export interface AthenaCapabilitiesIr {
  kind: typeof ATHENA_CAPABILITIES_IR_KIND;
  irVersion: typeof ATHENA_CAPABILITIES_IR_VERSION;
  capabilities: readonly AthenaCapabilityEntry[];
  metadata: AthenaCapabilitiesMetadata;
}
