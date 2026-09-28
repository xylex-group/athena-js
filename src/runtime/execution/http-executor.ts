import type {
  AthenaHttpTransportDomain,
  AthenaHttpTransportIR,
} from "../transport/http.ts";
import { joinAthenaHttpPath } from "../transport/join-path.ts";

export interface AthenaHttpExecutorOptions {
  baseUrl?: string;
  correlationId?: string;
  deadline?: number;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  requestId?: string;
  signal?: AbortSignal;
  traceId?: string;
}

export function createAthenaHttpExecutor(
  ir: AthenaHttpTransportIR,
  options?: AthenaHttpExecutorOptions
) {
  const dispatch = options?.fetch ?? fetch;
  const extraHeaders = options?.headers ?? {};
  const root = options?.baseUrl?.replace(/\/+$/, "") ?? "";
  const credentials: RequestCredentials =
    ir.credentials === "none" ? "omit" : "same-origin";
  const deadlineSignal = composeDeadlineSignal(options?.deadline);

  function urlFor(path: string): string {
    return joinAthenaHttpPath(root, path);
  }

  function executionHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (options?.requestId && !headers["x-athena-request-id"]) {
      headers["x-athena-request-id"] = options.requestId;
    }
    if (options?.traceId && !headers["x-athena-trace-id"]) {
      headers["x-athena-trace-id"] = options.traceId;
    }
    if (options?.correlationId && !headers["x-athena-correlation-id"]) {
      headers["x-athena-correlation-id"] = options.correlationId;
    }
    return headers;
  }

  async function send(url: string, init: RequestInit): Promise<Response> {
    return dispatch(url, {
      ...init,
      credentials,
      headers: {
        ...executionHeaders(),
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: init.signal ?? options?.signal ?? deadlineSignal,
    });
  }

  return {
    async postJson(
      url: string,
      body: unknown
    ): Promise<{ json: unknown; response: Response }> {
      const response = await send(urlFor(url), {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      });
      const json = await response.json().catch(() => undefined);
      return { json, response };
    },
    async resolveUrl(input: {
      explicit?: string;
      fallback: string;
      slot: AthenaHttpTransportDomain;
    }): Promise<string> {
      if (input.explicit) {
        return urlFor(input.explicit);
      }
      const probe = urlFor(input.fallback);
      const response = await send(probe, {
        headers: {
          accept: "application/json",
        },
        method: "GET",
      });
      const json = (await response.json().catch(() => undefined)) as
        | Record<string, unknown>
        | undefined;
      const fromTopology = advertisedBasePath(json, input.slot);
      if (fromTopology) {
        return urlFor(fromTopology);
      }
      const endpointsRaw = json?.endpoints;
      const endpoints = isRecord(endpointsRaw) ? endpointsRaw : undefined;
      const advertisedSlot = endpoints?.[input.slot];
      const advertised =
        typeof advertisedSlot === "string" ? advertisedSlot.trim() : "";
      if (advertised) {
        return urlFor(advertised);
      }
      if (response.ok && endpoints && advertisedSlot == null) {
        throw new Error(`${input.slot} runtime is not configured`);
      }
      return probe;
    },
  };
}

function composeDeadlineSignal(
  deadline: number | undefined
): AbortSignal | undefined {
  if (typeof deadline !== "number" || !Number.isFinite(deadline)) {
    return;
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(remaining);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function advertisedBasePath(
  document: Record<string, unknown> | undefined,
  slot: AthenaHttpTransportDomain
): string | undefined {
  if (!document) {
    return;
  }
  const protocol = isRecord(document.protocol) ? document.protocol : undefined;
  const minor = typeof protocol?.minor === "number" ? protocol.minor : 0;
  if (minor < 2) {
    return;
  }
  const topology = isRecord(document.topology) ? document.topology : undefined;
  const transports = isRecord(topology?.transports)
    ? topology.transports
    : undefined;
  const entry = isRecord(transports?.[slot]) ? transports[slot] : undefined;
  if (!entry) {
    return;
  }
  if (typeof entry.domain === "string" && entry.domain !== slot) {
    throw new Error(`${slot} transport domain does not match topology slot`);
  }
  return typeof entry.basePath === "string" && entry.basePath.trim()
    ? entry.basePath.trim()
    : undefined;
}
