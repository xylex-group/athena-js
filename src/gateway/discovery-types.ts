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
  billingIngress?: { webhook?: boolean };
  data?: boolean;
  delete: boolean;
  fetch: boolean;
  insert: boolean;
  models: "off" | "known-only" | "strict";
  nestedRelations: boolean;
  notifications?: boolean;
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
  notifications?: string;
  storage?: string;
}

export type AthenaRuntimeDiscoveryHttpTransport = {
  credentials?: "none" | "same-origin";
  kind: "http";
  origin?: "same-origin" | "remote";
  path: string;
};

export interface AthenaRuntimeDiscoveryTransports {
  auth?: AthenaRuntimeDiscoveryHttpTransport;
  billing?: AthenaRuntimeDiscoveryHttpTransport;
  data?: AthenaRuntimeDiscoveryHttpTransport;
  notifications?: AthenaRuntimeDiscoveryHttpTransport;
  storage?: AthenaRuntimeDiscoveryHttpTransport;
}

/** Parser DTO for topology.transports. Distinct from protocol 1.1 `transports`. */
export interface AthenaRuntimeDiscoveryTopologyHttp {
  basePath?: string;
  credentials?: "none" | "same-origin";
  domain?: string;
  encoding?: string;
  kind?: "http";
  origin?: string;
}

export interface AthenaRuntimeDiscoveryTopology {
  transports?: {
    auth?: AthenaRuntimeDiscoveryTopologyHttp;
    billing?: AthenaRuntimeDiscoveryTopologyHttp;
    data?: AthenaRuntimeDiscoveryTopologyHttp;
    storage?: AthenaRuntimeDiscoveryTopologyHttp;
  };
}

/** Redacted Local Runtime snapshot (no secrets, no minted WebAuthn challenges). */
export interface AthenaRuntimeDiscoveryPasskeyDiagnostics {
  authenticatorAttachment: "cross-platform" | "platform" | null;
  configured: boolean;
  enabled: boolean;
  onboardingEnabled: boolean;
  origins: string[];
  relatedOrigins: string[];
  residentKey: "discouraged" | "preferred" | "required" | null;
  rpId: string | null;
  rpName: string | null;
  timeoutMs: number;
  userVerification: "discouraged" | "preferred" | "required" | null;
}

export interface AthenaRuntimeDiscoveryConfigDiagnostics {
  authWarnings: string[];
  autoMigrate: boolean;
  databaseConfigured: boolean;
  generatorConfigFile: string | null;
  localMigrationFiles: number;
  migrationsDirectory: string;
  migrationsDirectoryFound: boolean;
  modelsAttached: boolean;
}

export interface AthenaRuntimeDiscoveryBillingIngressDiagnostics {
  enabled: boolean;
  endpoints: {
    classic: string;
    nextGen: string;
  };
  execution: "embedded" | "remote";
  verification: {
    classic: "authoritative_refetch";
    nextGen: "signature_and_refetch";
  };
}

export interface AthenaRuntimeDiscoveryDiagnostics {
  auth: "embedded" | "remote" | "disabled";
  billingIngress?: AthenaRuntimeDiscoveryBillingIngressDiagnostics;
  config?: AthenaRuntimeDiscoveryConfigDiagnostics;
  database: "postgres-direct" | "gateway" | "d1" | "sqlite-local";
  passkey: AthenaRuntimeDiscoveryPasskeyDiagnostics;
  runtime: "node" | "browser" | "react-native" | "cloudflare";
  storage: "http" | "r2" | "local" | "s3" | "none";
  /** Safe bucket label. Never credentials or endpoint URLs. */
  storageBucket?: string;
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
  topology?: AthenaRuntimeDiscoveryTopology;
  transports?: AthenaRuntimeDiscoveryTransports;
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
): AthenaRuntimeDiscoveryDocument | null | undefined {
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
  const flags = [
    "fetch",
    "insert",
    "update",
    "delete",
    "rawSql",
    "rpc",
    "nestedRelations",
    "policy",
  ] as const;
  for (const flag of flags) {
    if (typeof caps[flag] !== "boolean") {
      return null;
    }
  }
  const endpoints = parseDiscoveryEndpoints(value.endpoints);
  if (endpoints === undefined && value.endpoints !== undefined) {
    return null;
  }
  const transports = parseDiscoveryTransportsAdvertisement(value.transports);
  if (transports === undefined && value.transports !== undefined) {
    return null;
  }
  const diagnostics = parseDiscoveryDiagnostics(value.diagnostics);
  const topology = parseDiscoveryTopology(value.topology);
  if (topology === false) {
    return;
  }
  return {
    athena: true,
    capabilities: {
      auth,
      ...(typeof caps.billing === "boolean" ? { billing: caps.billing } : {}),
      ...(isRecord(caps.billingIngress) && caps.billingIngress.webhook === true
        ? { billingIngress: { webhook: true as const } }
        : {}),
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
    ...(transports ? { transports } : {}),
    protocol: { major, minor },
    ...(typeof value.release === "string" ? { release: value.release } : {}),
    runtime: value.runtime,
    runtimeImplementation: value.runtimeImplementation,
    ...(topology ? { topology } : {}),
  };
}

function parseDiscoveryHttpTransport(
  value: unknown
): AthenaRuntimeDiscoveryHttpTransport | undefined {
  if (!isRecord(value) || value.kind !== "http") {
    return;
  }
  if (typeof value.path !== "string" || !value.path.trim()) {
    return;
  }
  const origin = value.origin;
  if (origin !== undefined && origin !== "same-origin" && origin !== "remote") {
    return;
  }
  const credentials = value.credentials;
  let advertisedCredentials: "none" | "same-origin" | undefined;
  if (credentials === undefined || credentials === "bearer") {
    advertisedCredentials = undefined;
  } else if (credentials === "none" || credentials === "omit") {
    advertisedCredentials = "none";
  } else if (credentials === "same-origin" || credentials === "include") {
    advertisedCredentials = "same-origin";
  } else {
    return;
  }
  return {
    kind: "http",
    path: value.path,
    ...(origin ? { origin } : {}),
    ...(advertisedCredentials ? { credentials: advertisedCredentials } : {}),
  };
}

function parseDiscoveryTransportsAdvertisement(
  value: unknown
): AthenaRuntimeDiscoveryTransports | undefined {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  const data =
    value.data === undefined
      ? undefined
      : parseDiscoveryHttpTransport(value.data);
  const auth =
    value.auth === undefined
      ? undefined
      : parseDiscoveryHttpTransport(value.auth);
  const storage =
    value.storage === undefined
      ? undefined
      : parseDiscoveryHttpTransport(value.storage);
  const billing =
    value.billing === undefined
      ? undefined
      : parseDiscoveryHttpTransport(value.billing);
  if (
    (value.data !== undefined && !data) ||
    (value.auth !== undefined && !auth) ||
    (value.storage !== undefined && !storage) ||
    (value.billing !== undefined && !billing)
  ) {
    return;
  }
  return {
    ...(data ? { data } : {}),
    ...(auth ? { auth } : {}),
    ...(storage ? { storage } : {}),
    ...(billing ? { billing } : {}),
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
    return;
  }
  const transport = value.transport;
  if (
    transport !== undefined &&
    transport !== "same-origin" &&
    transport !== "remote"
  ) {
    return;
  }
  return {
    available: value.available,
    ...(transport ? { transport } : {}),
  };
}

function parseStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return;
  }
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      return;
    }
    items.push(entry);
  }
  return items;
}

function parseDiscoveryDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryDiagnostics | undefined {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (
    value.auth !== "embedded" &&
    value.auth !== "remote" &&
    value.auth !== "disabled"
  ) {
    return;
  }
  if (
    value.database !== "postgres-direct" &&
    value.database !== "gateway" &&
    value.database !== "d1" &&
    value.database !== "sqlite-local"
  ) {
    return;
  }
  if (
    value.runtime !== "node" &&
    value.runtime !== "browser" &&
    value.runtime !== "react-native" &&
    value.runtime !== "cloudflare"
  ) {
    return;
  }
  if (
    value.storage !== "http" &&
    value.storage !== "r2" &&
    value.storage !== "local" &&
    value.storage !== "s3" &&
    value.storage !== "none"
  ) {
    return;
  }
  const passkey = parseDiscoveryPasskeyDiagnostics(value.passkey);
  if (!passkey) {
    return;
  }
  const config = parseDiscoveryConfigDiagnostics(value.config);
  const storageBucket =
    typeof value.storageBucket === "string" && value.storageBucket.trim()
      ? value.storageBucket.trim()
      : undefined;
  const billingIngress = parseDiscoveryBillingIngressDiagnostics(
    value.billingIngress
  );
  return {
    auth: value.auth,
    ...(billingIngress ? { billingIngress } : {}),
    ...(config ? { config } : {}),
    database: value.database,
    passkey,
    runtime: value.runtime,
    storage: value.storage,
    ...(storageBucket ? { storageBucket } : {}),
  };
}

function parseDiscoveryBillingIngressDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryBillingIngressDiagnostics | undefined {
  if (!isRecord(value)) {
    return;
  }
  if (value.enabled !== true && value.enabled !== false) {
    return;
  }
  if (value.execution !== "embedded" && value.execution !== "remote") {
    return;
  }
  if (!(isRecord(value.endpoints) && isRecord(value.verification))) {
    return;
  }
  if (
    typeof value.endpoints.classic !== "string" ||
    !value.endpoints.classic.trim() ||
    typeof value.endpoints.nextGen !== "string" ||
    !value.endpoints.nextGen.trim()
  ) {
    return;
  }
  if (
    value.verification.classic !== "authoritative_refetch" ||
    value.verification.nextGen !== "signature_and_refetch"
  ) {
    return;
  }
  return {
    enabled: value.enabled,
    endpoints: {
      classic: value.endpoints.classic,
      nextGen: value.endpoints.nextGen,
    },
    execution: value.execution,
    verification: {
      classic: "authoritative_refetch",
      nextGen: "signature_and_refetch",
    },
  };
}

function parseDiscoveryConfigDiagnostics(
  value: unknown
): AthenaRuntimeDiscoveryConfigDiagnostics | undefined {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  if (
    typeof value.autoMigrate !== "boolean" ||
    typeof value.databaseConfigured !== "boolean" ||
    typeof value.localMigrationFiles !== "number" ||
    typeof value.migrationsDirectory !== "string" ||
    typeof value.migrationsDirectoryFound !== "boolean" ||
    typeof value.modelsAttached !== "boolean"
  ) {
    return;
  }
  const authWarnings = parseStringList(value.authWarnings);
  if (!authWarnings) {
    return;
  }
  if (
    value.generatorConfigFile !== null &&
    typeof value.generatorConfigFile !== "string"
  ) {
    return;
  }
  return {
    authWarnings,
    autoMigrate: value.autoMigrate,
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
    return;
  }
  if (
    typeof value.configured !== "boolean" ||
    typeof value.enabled !== "boolean" ||
    typeof value.onboardingEnabled !== "boolean" ||
    typeof value.timeoutMs !== "number"
  ) {
    return;
  }
  const origins = parseStringList(value.origins);
  const relatedOrigins = parseStringList(value.relatedOrigins);
  if (!(origins && relatedOrigins)) {
    return;
  }
  if (value.rpId !== null && typeof value.rpId !== "string") {
    return;
  }
  if (value.rpName !== null && typeof value.rpName !== "string") {
    return;
  }
  const userVerification = value.userVerification;
  if (
    userVerification !== null &&
    userVerification !== "discouraged" &&
    userVerification !== "preferred" &&
    userVerification !== "required"
  ) {
    return;
  }
  const authenticatorAttachment = value.authenticatorAttachment;
  if (
    authenticatorAttachment !== undefined &&
    authenticatorAttachment !== null &&
    authenticatorAttachment !== "cross-platform" &&
    authenticatorAttachment !== "platform"
  ) {
    return;
  }
  const residentKey = value.residentKey;
  if (
    residentKey !== undefined &&
    residentKey !== null &&
    residentKey !== "discouraged" &&
    residentKey !== "preferred" &&
    residentKey !== "required"
  ) {
    return;
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

function parseDiscoveryCredentials(
  value: unknown
): "none" | "same-origin" | undefined | false {
  if (value === undefined) {
    return;
  }
  if (value === "none" || value === "same-origin") {
    return value;
  }
  return false;
}

function parseDiscoveryTopologyHttp(
  value: unknown
): AthenaRuntimeDiscoveryTopologyHttp | undefined | false {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    return false;
  }
  if (value.kind !== undefined && value.kind !== "http") {
    return false;
  }
  if (typeof value.basePath === "string" && !value.basePath.trim()) {
    return false;
  }
  if (value.kind === "http" && value.basePath === "") {
    return false;
  }
  const credentials = parseDiscoveryCredentials(value.credentials);
  if (credentials === false) {
    return false;
  }
  if (
    value.origin !== undefined &&
    value.origin !== "same-origin" &&
    value.origin !== "remote" &&
    value.origin !== "absolute"
  ) {
    return false;
  }
  if (value.domain !== undefined && typeof value.domain !== "string") {
    return false;
  }
  if (
    value.domain === "nucleus" ||
    (typeof value.domain === "string" &&
      value.domain !== "storage" &&
      value.domain !== "billing" &&
      value.domain !== "data" &&
      value.domain !== "auth")
  ) {
    return false;
  }
  return {
    ...(typeof value.basePath === "string" ? { basePath: value.basePath } : {}),
    ...(credentials ? { credentials } : {}),
    ...(typeof value.domain === "string" ? { domain: value.domain } : {}),
    ...(typeof value.encoding === "string" ? { encoding: value.encoding } : {}),
    ...(value.kind === "http" ? { kind: "http" } : {}),
    ...(typeof value.origin === "string" ? { origin: value.origin } : {}),
  };
}

function parseDiscoveryTopology(
  value: unknown
): AthenaRuntimeDiscoveryTopology | undefined | false {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    return false;
  }
  const transportsRaw = value.transports;
  if (transportsRaw === undefined) {
    return {};
  }
  if (!isRecord(transportsRaw)) {
    return false;
  }
  const storage = parseDiscoveryTopologyHttp(transportsRaw.storage);
  const billing = parseDiscoveryTopologyHttp(transportsRaw.billing);
  const data = parseDiscoveryTopologyHttp(transportsRaw.data);
  const auth = parseDiscoveryTopologyHttp(transportsRaw.auth);
  if (
    storage === false ||
    billing === false ||
    data === false ||
    auth === false
  ) {
    return false;
  }
  return {
    transports: {
      ...(storage ? { storage } : {}),
      ...(billing ? { billing } : {}),
      ...(data ? { data } : {}),
      ...(auth ? { auth } : {}),
    },
  };
}

function parseDiscoveryEndpoints(
  value: unknown
): AthenaRuntimeDiscoveryEndpoints | null | undefined {
  if (value === undefined) {
    return null;
  }
  if (
    !isRecord(value) ||
    typeof value.data !== "string" ||
    !value.data.trim()
  ) {
    return;
  }
  const auth = value.auth;
  if (
    auth !== undefined &&
    auth !== false &&
    auth !== null &&
    typeof auth !== "string"
  ) {
    return;
  }
  const storage = value.storage;
  if (storage !== undefined && typeof storage !== "string") {
    return;
  }
  const billing = value.billing;
  if (billing !== undefined && typeof billing !== "string") {
    return;
  }
  return {
    data: value.data,
    ...(auth === undefined ? {} : { auth }),
    ...(typeof storage === "string" && storage.trim() ? { storage } : {}),
    ...(typeof billing === "string" && billing.trim() ? { billing } : {}),
  };
}
