import { AthenaConfigurationError } from "../config/errors.ts";
import {
  createAthenaGatewayClient,
  type AthenaGatewayClient,
} from "../gateway/client.ts";
import type {
  AthenaDiscoveryErrorCode,
  AthenaGatewayResponse,
} from "../gateway/types.ts";
import {
  DEFAULT_ATHENA_LOCAL_PATH,
  probeAthenaLocalRuntime,
  type AthenaDiscoveryRequire,
} from "./discovery.ts";

export type AthenaNextTopologyConfig = {
  discover?: "next" | false;
  fallback?: "error" | "hosted";
  local?: {
    path?: string;
  };
  prefer?: "local" | "hosted";
  probe?: {
    cache?: "client-lifetime" | "session";
    timeoutMs?: number;
  };
  require?: AthenaDiscoveryRequire;
};

export type AthenaNextLocalRuntimeMode = "auto" | false;

export interface AthenaNextAdapterConfig {
  localRuntime?: AthenaNextLocalRuntimeMode;
}

export interface NormalizedNextDiscovery {
  cache: "client-lifetime" | "session";
  enabled: true;
  fallback: "error" | "hosted";
  hosted?: { key: string; url: string };
  path: string;
  prefer: "local" | "hosted";
  require?: AthenaDiscoveryRequire;
  timeoutMs: number;
}

const DISCOVERY_CODES: readonly AthenaDiscoveryErrorCode[] = [
  "ATHENA_DISCOVERY_UNAVAILABLE",
  "ATHENA_DISCOVERY_INCOMPATIBLE",
  "ATHENA_PROTOCOL_INCOMPATIBLE",
  "ATHENA_DISCOVERY_CAPABILITY_MISSING",
  "ATHENA_RUNTIME_UNAVAILABLE",
];

const sessionProbeInflight = new Map<string, Promise<AthenaGatewayClient>>();

type SessionSelection = {
  endpoint?: string;
  selected: "local" | "hosted";
};

function sessionCacheKey(discovery: NormalizedNextDiscovery): string {
  return `${discovery.path}::${discovery.prefer}::${discovery.fallback}::${discovery.hosted?.url ?? ""}`;
}

function sessionStorageKey(discovery: NormalizedNextDiscovery): string {
  return `athena.discovery.v1:${discovery.path}:${discovery.prefer}`;
}

const sessionStorageKeys = new Set<string>();

function readSessionStorageSelection(
  discovery: NormalizedNextDiscovery
): SessionSelection | undefined {
  try {
    const storage = (
      globalThis as { sessionStorage?: { getItem(key: string): string | null } }
    ).sessionStorage;
    const raw = storage?.getItem(sessionStorageKey(discovery));
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as SessionSelection;
    if (parsed.selected === "local" || parsed.selected === "hosted") {
      return parsed;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function writeSessionStorageSelection(
  discovery: NormalizedNextDiscovery,
  selection: SessionSelection
): void {
  try {
    const storage = (
      globalThis as {
        sessionStorage?: { setItem(key: string, value: string): void };
      }
    ).sessionStorage;
    const key = sessionStorageKey(discovery);
    storage?.setItem(key, JSON.stringify(selection));
    sessionStorageKeys.add(key);
  } catch {
    // sessionStorage is optional; in-realm cache still applies.
  }
}

export function resetAthenaDiscoverySessionCache(): void {
  sessionProbeInflight.clear();
  try {
    const storage = (
      globalThis as {
        sessionStorage?: { removeItem(key: string): void };
      }
    ).sessionStorage;
    for (const key of sessionStorageKeys) {
      storage?.removeItem(key);
    }
  } catch {
    // ignore
  }
  sessionStorageKeys.clear();
}

function discoveryError(
  code: AthenaDiscoveryErrorCode,
  message: string
): Error & { discoveryCode: AthenaDiscoveryErrorCode } {
  const error = new AthenaConfigurationError(
    "ATHENA_RUNTIME_CONFIG_INVALID",
    `${code}: ${message}`,
    "db"
  ) as AthenaConfigurationError & { discoveryCode: AthenaDiscoveryErrorCode };
  error.discoveryCode = code;
  return error;
}

function readDiscoveryCode(error: Error): AthenaDiscoveryErrorCode {
  const tagged = (error as { discoveryCode?: AthenaDiscoveryErrorCode })
    .discoveryCode;
  if (tagged && DISCOVERY_CODES.includes(tagged)) {
    return tagged;
  }
  const fromMessage = DISCOVERY_CODES.find((code) =>
    error.message.startsWith(`${code}:`)
  );
  return fromMessage ?? "ATHENA_DISCOVERY_UNAVAILABLE";
}

function failedGatewayResponse<T>(error: Error): AthenaGatewayResponse<T> {
  const message = error.message;
  const code = readDiscoveryCode(error);
  return {
    count: null,
    data: null,
    error: message,
    errorDetails: {
      code,
      hint: code,
      message,
      status: 503,
    },
    ok: false,
    raw: { error: { code, message } },
    status: 503,
    statusText: "Error",
  };
}

export function resolveSameOriginBaseUrl(path: string): string {
  const origin =
    typeof globalThis === "object" &&
    globalThis &&
    "location" in globalThis &&
    typeof (globalThis as { location?: { origin?: unknown } }).location
      ?.origin === "string"
      ? (globalThis as { location: { origin: string } }).location.origin
      : "http://localhost";
  return new URL(path, `${origin}/`).toString().replace(/\/+$/, "");
}

export function normalizeNextDiscovery(input: {
  key?: string | null;
  next?: AthenaNextAdapterConfig;
  topology?: AthenaNextTopologyConfig;
  url?: string | null;
}): NormalizedNextDiscovery | undefined {
  const auto =
    input.topology?.discover === "next" || input.next?.localRuntime === "auto";
  if (!auto) {
    return undefined;
  }
  const fallback = input.topology?.fallback ?? "error";
  const url = input.url?.trim();
  const key = input.key?.trim();
  if (fallback === "hosted" && !(url && key)) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "ATHENA_DISCOVERY_CONFIG_INVALID: fallback \"hosted\" requires explicit url and key.",
      "db"
    );
  }
  return {
    cache: input.topology?.probe?.cache ?? "client-lifetime",
    enabled: true,
    fallback,
    ...(url && key ? { hosted: { key, url } } : {}),
    path: input.topology?.local?.path?.trim() || DEFAULT_ATHENA_LOCAL_PATH,
    prefer: input.topology?.prefer ?? "local",
    ...(input.topology?.require ? { require: input.topology.require } : {}),
    timeoutMs: input.topology?.probe?.timeoutMs ?? 1500,
  };
}

function failingGatewayClient(
  discovery: NormalizedNextDiscovery,
  error: Error
): AthenaGatewayClient {
  const fail = async <T>() => failedGatewayResponse<T>(error);
  return {
    baseUrl: discovery.path,
    buildHeaders() {
      return {};
    },
    deleteGateway: fail,
    fetchGateway: fail,
    insertGateway: fail,
    queryGateway: fail,
    async resolveCallOptions(options) {
      return options;
    },
    rpcGateway: fail,
    updateGateway: fail,
    async verifyConnection() {
      throw error;
    },
  };
}

function createHostedGatewayClient(
  discovery: NormalizedNextDiscovery
): AthenaGatewayClient | undefined {
  if (!discovery.hosted) {
    return undefined;
  }
  return createAthenaGatewayClient({
    apiKey: discovery.hosted.key,
    baseUrl: discovery.hosted.url,
  });
}

function createLocalGatewayClient(endpoint: string): AthenaGatewayClient {
  return createAthenaGatewayClient({
    baseUrl: resolveSameOriginBaseUrl(endpoint),
  });
}

function failingDiscoveryClient(
  discovery: NormalizedNextDiscovery,
  result: Awaited<ReturnType<typeof probeAthenaLocalRuntime>>
): AthenaGatewayClient {
  const error =
    result.status === "incompatible" && result.reason === "protocol"
      ? discoveryError(
          "ATHENA_PROTOCOL_INCOMPATIBLE",
          `Athena client protocol 1.x cannot use the discovered Local Runtime protocol ${result.document?.protocol.major ?? "?"}.x. Upgrade/downgrade @xylex-group/athena so the client and local runtime share a compatible protocol major.`
        )
      : result.status === "incompatible" && result.reason === "capability"
        ? discoveryError(
            "ATHENA_DISCOVERY_CAPABILITY_MISSING",
            "The same-origin Athena Local Runtime does not satisfy required capabilities."
          )
        : result.status === "incompatible"
          ? discoveryError(
              "ATHENA_DISCOVERY_INCOMPATIBLE",
              "The same-origin Athena Local Runtime is incompatible."
            )
          : discoveryError(
              "ATHENA_DISCOVERY_UNAVAILABLE",
              `No compatible Athena Local Runtime was found at ${discovery.path}. Mount createAthenaDataHandlers() under app/api/athena/[...path]/route.ts, or configure an explicit Athena Gateway URL.`
            );
  return failingGatewayClient(discovery, error);
}

async function selectDiscoveredGateway(
  discovery: NormalizedNextDiscovery
): Promise<AthenaGatewayClient> {
  if (discovery.prefer === "hosted") {
    const hosted = createHostedGatewayClient(discovery);
    if (hosted) {
      if (discovery.cache === "session") {
        writeSessionStorageSelection(discovery, { selected: "hosted" });
      }
      return hosted;
    }
  }

  if (discovery.cache === "session") {
    const persisted = readSessionStorageSelection(discovery);
    if (persisted?.selected === "hosted") {
      const hosted = createHostedGatewayClient(discovery);
      if (hosted) {
        return hosted;
      }
    }
    if (persisted?.selected === "local") {
      return createLocalGatewayClient(persisted.endpoint ?? discovery.path);
    }
  }

  const result = await probeAthenaLocalRuntime({
    path: discovery.path,
    require: discovery.require,
    timeoutMs: discovery.timeoutMs,
  });
  if (result.status === "compatible") {
    if (discovery.cache === "session") {
      writeSessionStorageSelection(discovery, {
        endpoint: result.endpoint,
        selected: "local",
      });
    }
    return createLocalGatewayClient(result.endpoint);
  }
  if (discovery.fallback === "hosted") {
    const hosted = createHostedGatewayClient(discovery);
    if (hosted) {
      if (discovery.cache === "session") {
        writeSessionStorageSelection(discovery, { selected: "hosted" });
      }
      return hosted;
    }
  }
  return failingDiscoveryClient(discovery, result);
}

export function createDiscoveredGatewayTransport(
  discovery: NormalizedNextDiscovery
): AthenaGatewayClient {
  let resolution: Promise<AthenaGatewayClient> | undefined;
  let selected: AthenaGatewayClient | undefined;

  const resolve = (): Promise<AthenaGatewayClient> => {
    if (selected) {
      return Promise.resolve(selected);
    }
    const materialize = async () => {
      const next = await selectDiscoveredGateway(discovery);
      selected = next;
      return next;
    };
    if (discovery.cache === "session") {
      const key = sessionCacheKey(discovery);
      const existing = sessionProbeInflight.get(key);
      if (existing) {
        return existing.then((client) => {
          selected = client;
          return client;
        });
      }
      const inflight = materialize();
      sessionProbeInflight.set(key, inflight);
      resolution = inflight;
      return inflight;
    }
    resolution ??= materialize();
    return resolution;
  };

  const run = async <T>(
    invoke: (client: AthenaGatewayClient) => Promise<AthenaGatewayResponse<T>>
  ): Promise<AthenaGatewayResponse<T>> => {
    try {
      return await invoke(await resolve());
    } catch (error) {
      return failedGatewayResponse(
        error instanceof Error
          ? error
          : discoveryError(
              "ATHENA_DISCOVERY_UNAVAILABLE",
              "Athena Local Runtime discovery failed."
            )
      );
    }
  };

  return {
    baseUrl: discovery.path,
    buildHeaders(options) {
      return selected?.buildHeaders(options) ?? {};
    },
    deleteGateway(payload, options) {
      return run((client) => client.deleteGateway(payload, options));
    },
    fetchGateway(payload, options) {
      return run((client) => client.fetchGateway(payload, options));
    },
    insertGateway(payload, options) {
      return run((client) => client.insertGateway(payload, options));
    },
    queryGateway(payload, options) {
      return run((client) => client.queryGateway(payload, options));
    },
    async resolveCallOptions(options) {
      return (await resolve()).resolveCallOptions(options);
    },
    rpcGateway(payload, options) {
      return run((client) => client.rpcGateway(payload, options));
    },
    updateGateway(payload, options) {
      return run((client) => client.updateGateway(payload, options));
    },
    async verifyConnection(options) {
      const client = await resolve();
      return client.verifyConnection(options);
    },
  };
}


