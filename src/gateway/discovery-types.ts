export interface AthenaRuntimeDiscoveryCapabilities {
  auth: false | "athena-session" | "jwt" | "custom" | "service";
  delete: boolean;
  fetch: boolean;
  insert: boolean;
  models: "off" | "known-only" | "strict";
  nestedRelations: boolean;
  policy: boolean;
  rawSql: boolean;
  rpc: boolean;
  update: boolean;
}

export interface AthenaRuntimeDiscoveryDocument {
  athena: true;
  capabilities: AthenaRuntimeDiscoveryCapabilities;
  protocol: {
    major: number;
    minor: number;
  };
  release?: string;
  runtime: "local" | "gateway";
  runtimeImplementation: "athena-js" | "athena-rust";
}

export type AthenaDiscoveryStatus =
  | "compatible"
  | "unavailable"
  | "incompatible";

export type AthenaDiscoveryReason =
  | "ok"
  | "http_404"
  | "timeout"
  | "network"
  | "malformed"
  | "protocol"
  | "capability";

export type AthenaDiscoveryResult =
  | {
      document: AthenaRuntimeDiscoveryDocument;
      endpoint: string;
      status: "compatible";
    }
  | {
      reason: AthenaDiscoveryReason;
      status: "unavailable";
    }
  | {
      document?: AthenaRuntimeDiscoveryDocument;
      reason: AthenaDiscoveryReason;
      status: "incompatible";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAthenaRuntimeDiscoveryDocument(
  value: unknown
): AthenaRuntimeDiscoveryDocument | null {
  if (!isRecord(value) || value.athena !== true) {
    return null;
  }
  if (value.runtime !== "local" && value.runtime !== "gateway") {
    return null;
  }
  if (
    value.runtimeImplementation !== "athena-js" &&
    value.runtimeImplementation !== "athena-rust"
  ) {
    return null;
  }
  if (!isRecord(value.protocol)) {
    return null;
  }
  const major = value.protocol.major;
  const minor = value.protocol.minor;
  if (typeof major !== "number" || typeof minor !== "number") {
    return null;
  }
  if (!isRecord(value.capabilities)) {
    return null;
  }
  const caps = value.capabilities;
  const models = caps.models;
  if (models !== "off" && models !== "known-only" && models !== "strict") {
    return null;
  }
  const auth = caps.auth;
  if (
    auth !== false &&
    auth !== "athena-session" &&
    auth !== "jwt" &&
    auth !== "custom" &&
    auth !== "service"
  ) {
    return null;
  }
  const flags = ["fetch", "insert", "update", "delete", "rawSql", "rpc", "nestedRelations", "policy"] as const;
  for (const flag of flags) {
    if (typeof caps[flag] !== "boolean") {
      return null;
    }
  }
  return {
    athena: true,
    capabilities: {
      auth,
      delete: caps.delete as boolean,
      fetch: caps.fetch as boolean,
      insert: caps.insert as boolean,
      models,
      nestedRelations: caps.nestedRelations as boolean,
      policy: caps.policy as boolean,
      rawSql: caps.rawSql as boolean,
      rpc: caps.rpc as boolean,
      update: caps.update as boolean,
    },
    protocol: { major, minor },
    ...(typeof value.release === "string" ? { release: value.release } : {}),
    runtime: value.runtime,
    runtimeImplementation: value.runtimeImplementation,
  };
}
