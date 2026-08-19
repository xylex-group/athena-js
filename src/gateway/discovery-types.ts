export type AthenaRuntimeDiscoveryAuthPrincipal =
  | false
  | "athena-session"
  | "jwt"
  | "custom"
  | "service";

export type AthenaRuntimeDiscoveryAuthTransport = "same-origin" | "remote";

/** Protocol 1.1 Auth HTTP advertisement (not Data principal mode). */
export interface AthenaRuntimeDiscoveryAuthAvailability {
  available: boolean;
  transport?: AthenaRuntimeDiscoveryAuthTransport;
}

export type AthenaRuntimeDiscoveryAuthCapability =
  | AthenaRuntimeDiscoveryAuthPrincipal
  | AthenaRuntimeDiscoveryAuthAvailability;

export interface AthenaRuntimeDiscoveryCapabilities {
  auth: AthenaRuntimeDiscoveryAuthCapability;
  data?: boolean;
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

export interface AthenaRuntimeDiscoveryEndpoints {
  auth?: string | false | null;
  data: string;
}

export interface AthenaRuntimeDiscoveryDocument {
  athena: true;
  capabilities: AthenaRuntimeDiscoveryCapabilities;
  endpoints?: AthenaRuntimeDiscoveryEndpoints;
  protocol: {
    major: number;
    minor: number;
  };
  release?: string;
  runtime: "local" | "gateway" | "next-local";
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
  if (
    value.runtime !== "local" &&
    value.runtime !== "gateway" &&
    value.runtime !== "next-local"
  ) {
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
  const auth = parseDiscoveryAuthCapability(caps.auth);
  if (auth === undefined) {
    return null;
  }
  const flags = ["fetch", "insert", "update", "delete", "rawSql", "rpc", "nestedRelations", "policy"] as const;
  for (const flag of flags) {
    if (typeof caps[flag] !== "boolean") {
      return null;
    }
  }
  const endpoints = parseDiscoveryEndpoints(value.endpoints);
  if (endpoints === undefined && value.endpoints !== undefined) {
    return null;
  }
  return {
    athena: true,
    capabilities: {
      auth,
      ...(typeof caps.data === "boolean" ? { data: caps.data } : {}),
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
    ...(endpoints ? { endpoints } : {}),
    protocol: { major, minor },
    ...(typeof value.release === "string" ? { release: value.release } : {}),
    runtime: value.runtime,
    runtimeImplementation: value.runtimeImplementation,
  };
}

function parseDiscoveryAuthCapability(
  value: unknown
): AthenaRuntimeDiscoveryAuthCapability | undefined {
  if (
    value === false ||
    value === "athena-session" ||
    value === "jwt" ||
    value === "custom" ||
    value === "service"
  ) {
    return value;
  }
  if (!isRecord(value) || typeof value.available !== "boolean") {
    return undefined;
  }
  const transport = value.transport;
  if (
    transport !== undefined &&
    transport !== "same-origin" &&
    transport !== "remote"
  ) {
    return undefined;
  }
  return {
    available: value.available,
    ...(transport ? { transport } : {}),
  };
}

function parseDiscoveryEndpoints(
  value: unknown
): AthenaRuntimeDiscoveryEndpoints | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (!isRecord(value) || typeof value.data !== "string" || !value.data.trim()) {
    return undefined;
  }
  const auth = value.auth;
  if (
    auth !== undefined &&
    auth !== false &&
    auth !== null &&
    typeof auth !== "string"
  ) {
    return undefined;
  }
  return {
    data: value.data,
    ...(auth === undefined ? {} : { auth }),
  };
}
