import {
  ATHENA_RUNTIME_PROTOCOL,
} from "../../gateway/protocol.ts";
import type { AthenaRuntimeDiscoveryDocument } from "../../gateway/discovery-types.ts";
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
