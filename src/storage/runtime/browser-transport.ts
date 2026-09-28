import type { AthenaRuntimeDiscoveryEndpoints } from "../../gateway/discovery-types.ts";
import { DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT } from "../../runtime/data/discovery-document.ts";
import { executeAthenaHttpTransport } from "../../runtime/transport/http/client.ts";
import type { AthenaHttpTransportIR } from "../../runtime/transport/http/ir.ts";
import { createAthenaHttpTransportIR } from "../../runtime/transport/http.ts";
import type { AthenaRuntimeTopologyIR } from "../../runtime/transport/topology.ts";
import {
  encodeAthenaStorageBytes,
  reviveAthenaStorageData,
} from "./bytes-envelope.ts";
import {
  AthenaStorageAuthorizationError,
  storageErrorResult,
  storageOkResult,
} from "./errors.ts";
import {
  type AuthorizedStorageOperation,
  isStorageObjectOp,
  type StorageObjectOp,
  type StorageObjectProvider,
} from "./types.ts";

/** Resolve the browser storage endpoint.
 *
 * @param endpoints - The endpoints to resolve.
 * @returns The resolved endpoint.
 */
export function resolveBrowserStorageEndpoint(
  endpoints?:
    | Pick<AthenaRuntimeDiscoveryEndpoints, "storage">
    | { storage?: string }
): string {
  const advertised = endpoints?.storage?.trim();
  return advertised || DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT;
}

/** Create an embedded storage facade.
 *
 * @returns The embedded storage facade.
 */
export function createEmbeddedStorageFacade(): {
  file: {
    delete: (input: unknown) => Promise<unknown>;
    get: (input: unknown) => Promise<unknown>;
    head: (input: unknown) => Promise<unknown>;
    list: (input?: unknown) => Promise<unknown>;
    upload: (input: unknown) => Promise<unknown>;
  };
} {
  const unused = (): Promise<unknown> =>
    Promise.reject(
      new Error(
        "Athena embedded storage facade must be wrapped by StorageRuntime"
      )
    );
  return {
    file: {
      delete: unused,
      get: unused,
      head: unused,
      list: unused,
      upload: unused,
    },
  };
}

function asExecutorTransport(
  ir: ReturnType<typeof createAthenaHttpTransportIR>
): AthenaHttpTransportIR {
  return {
    basePath: ir.basePath,
    credentials: ir.credentials,
    domain: ir.domain,
    encoding: "json",
    kind: "http",
    origin: ir.origin === "absolute" ? "remote" : ir.origin,
  };
}

type BrowserStorageTransportOptions = {
  endpoints?: { storage?: string };
  resolveTopology?: () => Promise<AthenaRuntimeTopologyIR>;
  topology?: AthenaRuntimeTopologyIR;
};

async function resolveStorageTransport(
  options?: BrowserStorageTransportOptions
): Promise<AthenaHttpTransportIR | undefined> {
  const explicit = options?.endpoints?.storage?.trim();
  if (explicit) {
    return asExecutorTransport(
      createAthenaHttpTransportIR({
        basePath: explicit,
        domain: "storage",
        origin: /^https?:\/\//i.test(explicit) ? "remote" : "same-origin",
      })
    );
  }
  const topology =
    options?.topology ??
    (options?.resolveTopology ? await options.resolveTopology() : undefined);
  if (topology) {
    const advertised = topology.transports.storage;
    // Discovery ran: missing Storage is fail-closed, not a Data/Gateway fallback.
    return advertised?.kind === "http" ? advertised : undefined;
  }
  return asExecutorTransport(
    createAthenaHttpTransportIR({
      basePath: DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
      domain: "storage",
      origin: "same-origin",
    })
  );
}

function asWireRecord(details: unknown): Record<string, unknown> | undefined {
  if (!details || typeof details !== "object") {
    return;
  }
  const record = details as Record<string, unknown>;
  const nested = record.error;
  if (nested && typeof nested === "object") {
    return nested as Record<string, unknown>;
  }
  return record;
}

function storageErrorNumberFromDetails(details: unknown): number | undefined {
  const record = asWireRecord(details);
  if (typeof record?.errorNumber === "number") {
    return record.errorNumber;
  }
}

type StorageAuthorizationWire = {
  missing: readonly string[];
  operation: StorageObjectOp;
};

function storageAuthorizationFromDetails(
  details: unknown
): StorageAuthorizationWire | undefined {
  const record = asWireRecord(details);
  if (!(record && isStorageObjectOp(record.operation))) {
    return;
  }
  if (!Array.isArray(record.missing)) {
    return;
  }
  const missing: string[] = [];
  for (const entry of record.missing) {
    if (typeof entry !== "string") {
      return;
    }
    missing.push(entry);
  }
  return {
    missing,
    operation: record.operation,
  };
}

function isGenericTransportHttpCode(code: string, status: number): boolean {
  return code === `ATHENA_TRANSPORT_HTTP_${status}`;
}

export function hasAuthoritativeStorageWireError(input: {
  code: string;
  errorNumber?: number;
  status: number;
}): boolean {
  const wire = input.code.trim();
  if (!wire || isGenericTransportHttpCode(wire, input.status)) {
    return false;
  }
  return (
    typeof input.errorNumber === "number" ||
    !wire.startsWith("ATHENA_TRANSPORT_HTTP_")
  );
}

export function projectStorageWireError(input: {
  code: string;
  details?: unknown;
  errorNumber?: number;
  message: string;
  status: number;
}) {
  const wireNumber =
    input.errorNumber ?? storageErrorNumberFromDetails(input.details);
  const authorization = storageAuthorizationFromDetails(input.details);
  if (input.code.trim() === "storage_authorization_denied" && authorization) {
    return storageErrorResult(
      new AthenaStorageAuthorizationError({
        missing: authorization.missing,
        operation: authorization.operation,
      })
    );
  }
  return storageErrorResult(
    wireNumber ?? 3010,
    input.code.trim(),
    input.message,
    input.status
  );
}

/** Compatibility projector for generic `ATHENA_TRANSPORT_HTTP_*` bodies only. */
export function projectLegacyGenericStorageHttpError(input: {
  message: string;
  status: number;
}) {
  const status = input.status;
  const errorNumber =
    status === 401 || status === 403 ? 3003 : status === 503 ? 3007 : 3010;
  const code =
    status === 401
      ? "storage_unauthenticated"
      : status === 403
        ? "storage_authorization_denied"
        : status === 503
          ? "storage_unavailable"
          : "storage_internal";
  return storageErrorResult(errorNumber, code, input.message, status);
}

function mapStorageHttpFailure(input: {
  code: string;
  details?: unknown;
  errorNumber?: number;
  message: string;
  status: number;
}) {
  const json = input.details as { error?: { code?: unknown } } | undefined;
  const nestedCode = json?.error?.code;
  const wireCode =
    typeof nestedCode === "string" && nestedCode.trim()
      ? nestedCode.trim()
      : input.code;
  const wireNumber =
    input.errorNumber ?? storageErrorNumberFromDetails(input.details);
  if (
    hasAuthoritativeStorageWireError({
      code: wireCode,
      errorNumber: wireNumber,
      status: input.status,
    })
  ) {
    return projectStorageWireError({
      ...input,
      code: wireCode,
      errorNumber: wireNumber,
    });
  }
  return projectLegacyGenericStorageHttpError({
    message: input.message,
    status: input.status,
  });
}

export function createBrowserStorageTransport(options?: {
  baseUrl?: string;
  endpoints?: { storage?: string };
  fetch?: typeof fetch;
  headers?: Record<string, string>;
  resolveTopology?: () => Promise<AthenaRuntimeTopologyIR>;
  topology?: AthenaRuntimeTopologyIR;
}): StorageObjectProvider {
  let pending: Promise<AthenaHttpTransportIR | undefined> | undefined;
  const loadTransport = () => {
    pending ??= resolveStorageTransport(options);
    return pending;
  };

  return {
    async execute(op: AuthorizedStorageOperation) {
      const transport = await loadTransport();
      if (!transport) {
        return storageErrorResult(
          3007,
          "storage_unavailable",
          "storage runtime is not configured",
          503
        );
      }
      const result = await executeAthenaHttpTransport({
        fetch: options?.fetch,
        headers: options?.headers,
        invocation: {
          domain: "storage",
          operation: op.op,
          payload: compactStoragePayload({
            body: op.body ? encodeAthenaStorageBytes(op.body) : undefined,
            contentType: op.contentType,
            cursor: op.cursor,
            key: op.key,
            limit: op.limit,
            metadata: op.metadata,
            prefix: op.prefix,
          }),
        },
        root: options?.baseUrl,
        transport,
      });
      if (!result.ok) {
        return mapStorageHttpFailure(result.error);
      }
      return storageOkResult(reviveAthenaStorageData(result.data));
    },
  };
}

function compactStoragePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }
  return compact;
}
