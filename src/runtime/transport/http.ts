export type AthenaHttpTransportDomain = "storage" | "billing" | "data" | "auth";

export type AthenaHttpTransportOrigin = "same-origin" | "remote" | "absolute";

export type AthenaHttpTransportCredentials = "same-origin" | "none";

export interface AthenaHttpTransportIR {
  basePath: string;
  credentials: AthenaHttpTransportCredentials;
  domain: AthenaHttpTransportDomain;
  encoding: "json";
  kind: "http";
  origin: AthenaHttpTransportOrigin;
  version: 1;
}

const HTTP_TRANSPORT_DOMAINS: readonly AthenaHttpTransportDomain[] = [
  "storage",
  "billing",
  "data",
  "auth",
];

const TOPOLOGY_SLOTS: readonly AthenaHttpTransportDomain[] = [
  "data",
  "auth",
  "storage",
  "billing",
];

export function isAthenaHttpTransportDomain(
  value: string
): value is AthenaHttpTransportDomain {
  return (HTTP_TRANSPORT_DOMAINS as readonly string[]).includes(value);
}

export function createAthenaHttpTransportIR(input: {
  basePath: string;
  credentials?: AthenaHttpTransportCredentials;
  domain: string;
  origin?: string;
}): AthenaHttpTransportIR {
  if (typeof input.basePath !== "string" || !input.basePath.trim()) {
    throw new Error("AthenaHttpTransportIR.basePath is required");
  }
  if (!isAthenaHttpTransportDomain(input.domain)) {
    throw new Error("AthenaHttpTransportIR.domain is invalid");
  }
  const scheme = schemeOf(input.basePath);
  if (scheme && scheme !== "http" && scheme !== "https") {
    throw new Error("AthenaHttpTransportIR.basePath scheme is unsupported");
  }
  if (isMalformedHttpUrl(input.basePath)) {
    throw new Error("AthenaHttpTransportIR.basePath is not a valid HTTP URL");
  }
  const origin = originClass(input.origin, input.basePath);
  if (
    origin === "same-origin" &&
    isAbsoluteHttpUrl(input.basePath) &&
    isMalformedHttpUrl(input.basePath)
  ) {
    throw new Error(
      "AthenaHttpTransportIR.origin same-origin cannot use a malformed absolute URL"
    );
  }
  const credentials = credentialsFor(input.credentials, origin);
  return {
    basePath: input.basePath,
    credentials,
    domain: input.domain,
    encoding: "json",
    kind: "http",
    origin,
    version: 1,
  };
}

export function validateAthenaTransportIR(ir: unknown): AthenaHttpTransportIR {
  if (!ir || typeof ir !== "object") {
    throw new Error("AthenaHttpTransportIR is required");
  }
  const record = ir as Record<string, unknown>;
  if (record.kind !== "http") {
    throw new Error("AthenaHttpTransportIR.kind must be http");
  }
  if (record.version !== 1) {
    throw new Error("AthenaHttpTransportIR.version must be 1");
  }
  if (
    typeof record.domain !== "string" ||
    !isAthenaHttpTransportDomain(record.domain)
  ) {
    throw new Error("AthenaHttpTransportIR.domain is invalid");
  }
  if (typeof record.basePath !== "string" || !record.basePath) {
    throw new Error("AthenaHttpTransportIR.basePath is required");
  }
  if (
    record.origin !== "same-origin" &&
    record.origin !== "remote" &&
    record.origin !== "absolute"
  ) {
    throw new Error("AthenaHttpTransportIR.origin is invalid");
  }
  if (record.credentials !== "same-origin" && record.credentials !== "none") {
    throw new Error("AthenaHttpTransportIR.credentials is invalid");
  }
  if (record.encoding !== "json") {
    throw new Error("AthenaHttpTransportIR.encoding is invalid");
  }
  if (record.origin !== "same-origin" && record.credentials === "same-origin") {
    throw new Error(
      "AthenaHttpTransportIR.credentials same-origin requires same-origin"
    );
  }
  const slot = slotFromBasePath(record.basePath);
  if (slot && slot !== record.domain) {
    throw new Error(
      "AthenaHttpTransportIR.domain does not match topology slot"
    );
  }
  return record as unknown as AthenaHttpTransportIR;
}

export function validateAthenaRuntimeTopologyIR(value: unknown): void {
  if (value == null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("AthenaRuntimeTopologyIR is invalid");
  }
  const transports = (value as { transports?: unknown }).transports;
  if (transports == null) {
    return;
  }
  if (typeof transports !== "object" || Array.isArray(transports)) {
    throw new Error("AthenaRuntimeTopologyIR.transports is invalid");
  }
  const slots = transports as Record<string, unknown>;
  for (const slot of TOPOLOGY_SLOTS) {
    const entry = slots[slot];
    if (entry == null) {
      continue;
    }
    if (typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`${slot} transport descriptor is invalid`);
    }
    const domain = (entry as { domain?: unknown }).domain;
    if (typeof domain === "string" && domain !== slot) {
      throw new Error(`${slot} transport domain does not match topology slot`);
    }
  }
}

export {
  type AthenaHttpExecutorOptions,
  createAthenaHttpExecutor,
} from "../execution/http-executor.ts";
export { joinAthenaHttpPath } from "./join-path.ts";

function originClass(
  origin: string | undefined,
  basePath: string
): AthenaHttpTransportOrigin {
  if (origin === "same-origin") {
    if (isMalformedHttpUrl(basePath)) {
      throw new Error(
        "AthenaHttpTransportIR.origin same-origin cannot use a malformed absolute URL"
      );
    }
    return "same-origin";
  }
  if (origin === "remote" || origin === "absolute") {
    return origin;
  }
  if (isAbsoluteHttpUrl(basePath)) {
    return "remote";
  }
  if (origin && /^https?:\/\//i.test(origin)) {
    return "absolute";
  }
  return "same-origin";
}

function credentialsFor(
  credentials: AthenaHttpTransportCredentials | undefined,
  origin: AthenaHttpTransportOrigin
): AthenaHttpTransportCredentials {
  if (credentials === "same-origin" || credentials === "none") {
    if (origin !== "same-origin" && credentials === "same-origin") {
      throw new Error(
        "AthenaHttpTransportIR.credentials same-origin requires same-origin"
      );
    }
    return credentials;
  }
  if (credentials != null) {
    throw new Error("AthenaHttpTransportIR.credentials is invalid");
  }
  return origin === "same-origin" ? "same-origin" : "none";
}

function schemeOf(basePath: string): string | undefined {
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(basePath);
  return match?.[1]?.toLowerCase();
}

function isAbsoluteHttpUrl(basePath: string): boolean {
  return /^https?:\/\//i.test(basePath);
}

function isMalformedHttpUrl(basePath: string): boolean {
  if (!isAbsoluteHttpUrl(basePath)) {
    return false;
  }
  try {
    const url = new URL(basePath);
    return !url.hostname;
  } catch {
    return true;
  }
}

function slotFromBasePath(
  basePath: string
): AthenaHttpTransportDomain | undefined {
  let path = basePath;
  if (isAbsoluteHttpUrl(basePath)) {
    try {
      path = new URL(basePath).pathname;
    } catch {
      path = basePath;
    }
  }
  if (path.includes("/storage")) {
    return "storage";
  }
  if (path.includes("/billing")) {
    return "billing";
  }
  if (path.includes("/auth")) {
    return "auth";
  }
}
