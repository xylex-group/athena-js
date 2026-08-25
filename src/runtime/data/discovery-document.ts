import {
  ATHENA_NEXT_RUNTIME_PROTOCOL,
  ATHENA_RUNTIME_PROTOCOL,
} from "../../gateway/protocol.ts";
import type {
  AthenaRuntimeDiscoveryAuthAvailability,
  AthenaRuntimeDiscoveryDocument,
} from "../../gateway/discovery-types.ts";
import type { AthenaServerRuntime } from "./types.ts";

export function serializeAthenaRuntimeDiscoveryDocument(
  runtime: AthenaServerRuntime
): AthenaRuntimeDiscoveryDocument {
  const caps = runtime.capabilities;
  return {
    athena: true,
    capabilities: {
      auth: caps.auth,
      delete: true,
      fetch: true,
      insert: true,
      models: caps.modelEnforcement,
      nestedRelations: caps.nestedRelations,
      policy: caps.policies,
      rawSql: caps.rawSql,
      rpc: caps.rpc,
      update: true,
    },
    protocol: {
      major: ATHENA_RUNTIME_PROTOCOL.major,
      minor: ATHENA_RUNTIME_PROTOCOL.minor,
    },
    runtime: "local",
    runtimeImplementation: "athena-js",
  };
}

export const DEFAULT_ATHENA_NEXT_DATA_ENDPOINT = "/api/athena";
export const DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT = "/api/auth";
export const DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT = "/api/athena/storage";
export const DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT = "/api/athena/billing";

export function serializeAthenaNextRuntimeDiscoveryDocument(input: {
  auth: AthenaRuntimeDiscoveryAuthAvailability;
  dataRuntime: AthenaServerRuntime;
  endpoints: { auth?: string; billing?: string; data?: string; storage?: string };
}): AthenaRuntimeDiscoveryDocument {
  const base = serializeAthenaRuntimeDiscoveryDocument(input.dataRuntime);
  const dataPath = input.endpoints.data ?? DEFAULT_ATHENA_NEXT_DATA_ENDPOINT;
  return {
    ...base,
    capabilities: {
      ...base.capabilities,
      auth: input.auth.available
        ? {
            available: true,
            ...(input.auth.transport ? { transport: input.auth.transport } : {}),
          }
        : { available: false },
      billing: Boolean(input.endpoints.billing),
      data: true,
      storage: Boolean(input.endpoints.storage),
    },
    endpoints: {
      data: dataPath,
      ...(input.endpoints.storage
        ? { storage: input.endpoints.storage }
        : {}),
      ...(input.endpoints.billing
        ? { billing: input.endpoints.billing }
        : {}),
      ...(input.auth.available && input.endpoints.auth
        ? { auth: input.endpoints.auth }
        : {}),
    },
    protocol: {
      major: ATHENA_NEXT_RUNTIME_PROTOCOL.major,
      minor: ATHENA_NEXT_RUNTIME_PROTOCOL.minor,
    },
    runtime: "next-local",
  };
}
