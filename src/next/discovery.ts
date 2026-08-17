import {
  parseAthenaRuntimeDiscoveryDocument,
  type AthenaDiscoveryResult,
  type AthenaRuntimeDiscoveryCapabilities,
} from "../gateway/discovery-types.ts";
import { isCompatibleAthenaRuntimeProtocol } from "../gateway/protocol.ts";

export const DEFAULT_ATHENA_LOCAL_PATH = "/api/athena";

export interface AthenaDiscoveryRequire {
  models?: "off" | "known-only" | "strict";
  policy?: true;
  rawSql?: true;
}

export interface ProbeAthenaLocalRuntimeOptions {
  fetchImpl?: typeof fetch;
  path?: string;
  require?: AthenaDiscoveryRequire;
  timeoutMs?: number;
}

function joinPath(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}${suffix}`;
}

function meetsRequirements(
  capabilities: AthenaRuntimeDiscoveryCapabilities,
  require?: AthenaDiscoveryRequire
): boolean {
  if (!require) {
    return true;
  }
  if (require.policy === true && capabilities.policy !== true) {
    return false;
  }
  if (require.rawSql === true && capabilities.rawSql !== true) {
    return false;
  }
  if (require.models) {
    const rank = { off: 0, "known-only": 1, strict: 2 } as const;
    if (rank[capabilities.models] < rank[require.models]) {
      return false;
    }
  }
  return true;
}

async function fetchDiscoveryJson(
  url: string,
  fetchImpl: typeof fetch,
  timeoutMs: number
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; reason: "http_404" | "timeout" | "network" | "malformed" }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      credentials: "same-origin",
      method: "GET",
      signal: controller.signal,
    });
    if (response.status === 404) {
      return { ok: false, reason: "http_404" };
    }
    if (!response.ok) {
      return { ok: false, reason: "network" };
    }
    try {
      return { ok: true, value: await response.json() };
    } catch {
      return { ok: false, reason: "malformed" };
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Side-effect-free same-origin Local Runtime probe.
 * Never issues CRUD. Availability ≠ compatibility.
 */
export async function probeAthenaLocalRuntime(
  options: ProbeAthenaLocalRuntimeOptions = {}
): Promise<AthenaDiscoveryResult> {
  const path = options.path?.trim() || DEFAULT_ATHENA_LOCAL_PATH;
  const timeoutMs = options.timeoutMs ?? 1500;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const candidates = [
    joinPath(path, "/capabilities"),
    joinPath(path, "/health"),
  ];

  let lastUnavailable: AthenaDiscoveryResult = {
    reason: "network",
    status: "unavailable",
  };

  for (const url of candidates) {
    const fetched = await fetchDiscoveryJson(url, fetchImpl, timeoutMs);
    if (!fetched.ok) {
      lastUnavailable = { reason: fetched.reason, status: "unavailable" };
      if (fetched.reason === "http_404") {
        continue;
      }
      if (fetched.reason === "timeout" || fetched.reason === "network") {
        return lastUnavailable;
      }
      continue;
    }
    const document = parseAthenaRuntimeDiscoveryDocument(fetched.value);
    if (!document) {
      lastUnavailable = { reason: "malformed", status: "unavailable" };
      continue;
    }
    if (!isCompatibleAthenaRuntimeProtocol(document.protocol)) {
      return { document, reason: "protocol", status: "incompatible" };
    }
    if (!meetsRequirements(document.capabilities, options.require)) {
      return { document, reason: "capability", status: "incompatible" };
    }
    return { document, endpoint: path, status: "compatible" };
  }

  return lastUnavailable;
}
