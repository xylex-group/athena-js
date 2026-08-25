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
  billing?: boolean;
  data?: boolean;
  delete: boolean;
  fetch: boolean;
  insert: boolean;
  models: "off" | "known-only" | "strict";
  nestedRelations: boolean;
  policy: boolean;
  rawSql: boolean;
  rpc: boolean;
  storage?: boolean;
  update: boolean;
}

export interface AthenaRuntimeDiscoveryEndpoints {
  auth?: string | false | null;
  billing?: string;
  data: string;
  storage?: string;
}

/** Redacted Local Runtime snapshot (no secrets, no minted WebAuthn challenges). */
export interface AthenaRuntimeDiscoveryPasskeyDiagnostics {
  configured: boolean;
  enabled: boolean;
  onboardingEnabled: boolean;
  origins: string[];
  relatedOrigins: string[];
  rpId: string | null;
  rpName: string | null;
  authenticatorAttachment: "cross-platform" | "platform" | null;
  residentKey: "discouraged" | "preferred" | "required" | null;
  timeoutMs: number;
  userVerification: "discouraged" | "preferred" | "required" | null;
}

export interface AthenaRuntimeDiscoveryConfigDiagnostics {
  autoMigrate: boolean;
  authWarnings: string[];
  databaseConfigured: boolean;
  generatorConfigFile: string | null;
  localMigrationFiles: number;
  migrationsDirectory: string;
  migrationsDirectoryFound: boolean;
  modelsAttached: boolean;
}

export interface AthenaRuntimeDiscoveryDiagnostics {
  auth: "embedded" | "remote" | "disabled";
  config?: AthenaRuntimeDiscoveryConfigDiagnostics;
  database: "postgres-direct" | "gateway" | "d1";
  passkey: AthenaRuntimeDiscoveryPasskeyDiagnostics;
  runtime: "node" | "browser" | "react-native" | "cloudflare";
  storage: "http" | "r2" | "local" | "s3" | "none";
}

export interface AthenaRuntimeDiscoveryDocument {
  athena: true;
  capabilities: AthenaRuntimeDiscoveryCapabilities;
  diagnostics?: AthenaRuntimeDiscoveryDiagnostics;
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
  const diagnostics = parseDiscoveryDiagnostics(value.diagnostics);
  return {
    athena: true,
    capabilities: {
      auth,
      ...(typeof caps.billing === "boolean" ? { billing: caps.billing } : {}),
      ...(typeof caps.data === "boolean" ? { data: caps.data } : {}),
      delete: caps.delete as boolean,
      fetch: caps.fetch as boolean,
      insert: caps.insert as boolean,
      models,
      nestedRelations: caps.nestedRelations as boolean,
      policy: caps.policy as boolean,
      rawSql: caps.rawSql as boolean,
      rpc: caps.rpc as boolean,
      ...(typeof caps.storage === "boolean" ? { storage: caps.storage } : {}),
      update: caps.update as boolean,
    },
    ...(diagnostics ? { diagnostics } : {}),
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

function parseStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return undefined;
    }
    items.push(entry);
  }
  return items;
}

function parseDiscoveryDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryDiagnostics | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    value.auth !== "embedded" &&
    value.auth !== "remote" &&
    value.auth !== "disabled"
  ) {
    return undefined;
  }
  if (
    value.database !== "postgres-direct" &&
    value.database !== "gateway" &&
    value.database !== "d1"
  ) {
    return undefined;
  }
  if (
    value.runtime !== "node" &&
    value.runtime !== "browser" &&
    value.runtime !== "react-native" &&
    value.runtime !== "cloudflare"
  ) {
    return undefined;
  }
  if (
    value.storage !== "http" &&
    value.storage !== "r2" &&
    value.storage !== "local" &&
    value.storage !== "s3" &&
    value.storage !== "none"
  ) {
    return undefined;
  }
  const passkey = parseDiscoveryPasskeyDiagnostics(value.passkey);
  if (!passkey) {
    return undefined;
  }
  const config = parseDiscoveryConfigDiagnostics(value.config);
  return {
    auth: value.auth,
    ...(config ? { config } : {}),
    database: value.database,
    passkey,
    runtime: value.runtime,
    storage: value.storage,
  };
}

function parseDiscoveryConfigDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryConfigDiagnostics | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.autoMigrate !== "boolean" ||
    typeof value.databaseConfigured !== "boolean" ||
    typeof value.localMigrationFiles !== "number" ||
    typeof value.migrationsDirectory !== "string" ||
    typeof value.migrationsDirectoryFound !== "boolean" ||
    typeof value.modelsAttached !== "boolean"
  ) {
    return undefined;
  }
  const authWarnings = parseStringList(value.authWarnings);
  if (!authWarnings) {
    return undefined;
  }
  if (
    value.generatorConfigFile !== null &&
    typeof value.generatorConfigFile !== "string"
  ) {
    return undefined;
  }
  return {
    autoMigrate: value.autoMigrate,
    authWarnings,
    databaseConfigured: value.databaseConfigured,
    generatorConfigFile: value.generatorConfigFile,
    localMigrationFiles: value.localMigrationFiles,
    migrationsDirectory: value.migrationsDirectory,
    migrationsDirectoryFound: value.migrationsDirectoryFound,
    modelsAttached: value.modelsAttached,
  };
}

function parseDiscoveryPasskeyDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryPasskeyDiagnostics | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (
    typeof value.configured !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.onboardingEnabled !== "boolean" ||
    typeof value.timeoutMs !== "number"
  ) {
    return undefined;
  }
  const origins = parseStringList(value.origins);
  const relatedOrigins = parseStringList(value.relatedOrigins);
  if (!origins || !relatedOrigins) {
    return undefined;
  }
  if (value.rpId !== null && typeof value.rpId !== "string") {
    return undefined;
  }
  if (value.rpName !== null && typeof value.rpName !== "string") {
    return undefined;
  }
  const userVerification = value.userVerification;
  if (
    userVerification !== null &&
    userVerification !== "discouraged" &&
    userVerification !== "preferred" &&
    userVerification !== "required"
  ) {
    return undefined;
  }
  const authenticatorAttachment = value.authenticatorAttachment;
  if (
    authenticatorAttachment !== undefined &&
    authenticatorAttachment !== null &&
    authenticatorAttachment !== "cross-platform" &&
    authenticatorAttachment !== "platform"
  ) {
    return undefined;
  }
  const residentKey = value.residentKey;
  if (
    residentKey !== undefined &&
    residentKey !== null &&
    residentKey !== "discouraged" &&
    residentKey !== "preferred" &&
    residentKey !== "required"
  ) {
    return undefined;
  }
  return {
    authenticatorAttachment:
      authenticatorAttachment === "cross-platform" ||
      authenticatorAttachment === "platform"
        ? authenticatorAttachment
        : null,
    configured: value.configured,
    enabled: value.enabled,
    onboardingEnabled: value.onboardingEnabled,
    origins,
    relatedOrigins,
    residentKey:
      residentKey === "discouraged" ||
      residentKey === "preferred" ||
      residentKey === "required"
        ? residentKey
        : null,
    rpId: value.rpId,
    rpName: value.rpName,
    timeoutMs: value.timeoutMs,
    userVerification,
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
  const storage = value.storage;
  if (storage !== undefined && typeof storage !== "string") {
    return undefined;
  }
  const billing = value.billing;
  if (billing !== undefined && typeof billing !== "string") {
    return undefined;
  }
  return {
    data: value.data,
    ...(auth === undefined ? {} : { auth }),
    ...(typeof storage === "string" && storage.trim()
      ? { storage }
      : {}),
    ...(typeof billing === "string" && billing.trim()
      ? { billing }
      : {}),
  };
}
