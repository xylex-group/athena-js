import type {
  AthenaRuntimeDiscoveryAuthAvailability,
  AthenaRuntimeDiscoveryDocument,
} from "../../gateway/discovery-types.ts";
import {
  ATHENA_NEXT_RUNTIME_PROTOCOL,
  ATHENA_RUNTIME_PROTOCOL,
} from "../../gateway/protocol.ts";
import type { AthenaServerRuntime } from "./types.ts";
import { projectCapabilitiesToDiscovery } from "./capabilities-projection.ts";

export function serializeAthenaRuntimeDiscoveryDocument(
  runtime: Pick<AthenaServerRuntime, "capabilities" | "capabilitiesIr">
): AthenaRuntimeDiscoveryDocument {
  const runtimeCaps = runtime.capabilities;
  const baseCaps = {
    auth: runtimeCaps.auth,
    delete: true,
    fetch: true,
    insert: true,
    models: runtimeCaps.modelEnforcement,
    nestedRelations: runtimeCaps.nestedRelations,
    policy: runtimeCaps.policies,
    rawSql: runtimeCaps.rawSql,
    rpc: runtimeCaps.rpc,
    update: true,
  } as const;
  const caps = runtime.capabilitiesIr
    ? projectCapabilitiesToDiscovery(runtime.capabilitiesIr, baseCaps)
    : baseCaps;
  return {
    athena: true,
    capabilities: {
      auth: caps.auth,
      delete: caps.delete,
      fetch: caps.fetch,
      insert: caps.insert,
      models: caps.models,
      nestedRelations: caps.nestedRelations,
      policy: caps.policy,
      rawSql: caps.rawSql,
      rpc: caps.rpc,
      update: caps.update,
    },
    protocol: {
      major: ATHENA_RUNTIME_PROTOCOL.major,
      minor: ATHENA_RUNTIME_PROTOCOL.minor,
    },
    runtime: "local",
    runtimeImplementation: "athena-js",
  };
}

/** The default Athena Next data endpoint. */
export const DEFAULT_ATHENA_NEXT_DATA_ENDPOINT = "/api/athena";

/** The default Athena Next auth endpoint. */
export const DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT = "/api/auth";

/** The default Athena Next storage endpoint. */
export const DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT = "/api/athena/storage";

/** The default Athena Next billing endpoint. */
export const DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT = "/api/athena/billing";
export const DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT =
  "/api/athena/billing/webhook";
export const DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT =
  "/api/athena/notifications";

function advertiseHttpTransport(
  path: string,
  origin?: "same-origin" | "remote"
): {
  credentials: "none" | "same-origin";
  kind: "http";
  origin: "same-origin" | "remote";
  path: string;
} {
  const resolvedOrigin =
    origin ?? (/^https?:\/\//i.test(path) ? "remote" : "same-origin");
  return {
    credentials: resolvedOrigin === "remote" ? "none" : "same-origin",
    kind: "http",
    origin: resolvedOrigin,
    path,
  };
}

export function serializeAthenaNextRuntimeDiscoveryDocument(input: {
  auth: AthenaRuntimeDiscoveryAuthAvailability;
  dataRuntime: AthenaServerRuntime;
  endpoints: {
    auth?: string;
    billing?: string;
    data?: string;
    storage?: string;
  };
}): AthenaRuntimeDiscoveryDocument {
  const base = serializeAthenaRuntimeDiscoveryDocument(input.dataRuntime);
  const dataPath = input.endpoints.data ?? DEFAULT_ATHENA_NEXT_DATA_ENDPOINT;
  const authPath =
    input.auth.available && input.endpoints.auth
      ? input.endpoints.auth
      : undefined;
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      auth: input.auth.available
        ? {
            available: true,
            ...(input.auth.transport
              ? { transport: input.auth.transport }
              : {}),
          }
        : { available: false },
      billing: Boolean(input.endpoints.billing),
      billingIngress: input.endpoints.billing ? { webhook: true } : undefined,
      data: true,
      storage: Boolean(input.endpoints.storage),
    },
    endpoints: {
      data: dataPath,
      ...(input.endpoints.storage ? { storage: input.endpoints.storage } : {}),
      ...(input.endpoints.billing ? { billing: input.endpoints.billing } : {}),
      ...(authPath ? { auth: authPath } : {}),
    },
    protocol: {
      major: ATHENA_NEXT_RUNTIME_PROTOCOL.major,
      minor: ATHENA_NEXT_RUNTIME_PROTOCOL.minor,
    },
    runtime: "next-local",
    transports: {
      data: advertiseHttpTransport(dataPath),
      ...(authPath
        ? {
            auth: advertiseHttpTransport(authPath, input.auth.transport),
          }
        : {}),
      ...(input.endpoints.storage
        ? { storage: advertiseHttpTransport(input.endpoints.storage) }
        : {}),
      ...(input.endpoints.billing
        ? { billing: advertiseHttpTransport(input.endpoints.billing) }
        : {}),
    },
  };
}
