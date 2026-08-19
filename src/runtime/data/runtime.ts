import type { AthenaGatewayClient } from "../../gateway/client.ts";
import { ATHENA_PG_DIRECT_BASE_URL } from "../../postgres/constants.ts";
import { createPostgresDirectTransport } from "../../postgres/transport.ts";
import { catalogFromModels } from "../../query/engine/index.ts";
import { executeAthenaRequest } from "./executor.ts";
import { runtimeConfigError } from "./errors.ts";
import {
  buildAthenaRuntimeModelIndex,
  resolveModelEnforcement,
} from "./model-registry.ts";
import type { AthenaPolicyMode } from "../../policy/decision.ts";
import {
  createPolicyRegistry,
  normalizePolicyDefinitions,
} from "../../policy/registry.ts";
import { AthenaPolicyConfigError } from "../../policy/validate-ir.ts";
import { assertBrowserPolicyProfile, resolveAthenaRuntimeHttpProfile } from "./http-profile.ts";
import {
  authModeFromMaterial,
  normalizeAthenaRuntimeAuth,
} from "./resolve-principal.ts";
import type {
  AthenaRuntimeCapabilities,
  AthenaRuntimeRequest,
  AthenaRuntimeRequestContext,
  AthenaServerRuntime,
  CreateAthenaServerRuntimeConfig,
} from "./types.ts";

function normalizeOptional(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveDatabaseUrl(
  config: CreateAthenaServerRuntimeConfig
): string | undefined {
  return (
    normalizeOptional(config.databaseUrl) ??
    normalizeOptional(config.db?.databaseUrl)
  );
}

function resolveFlag(
  value: boolean | { enabled: boolean } | undefined
): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return value?.enabled === true;
}

function resolvePolicyMode(
  config: CreateAthenaServerRuntimeConfig
): AthenaPolicyMode {
  if (config.policies?.mode) {
    return config.policies.mode;
  }
  if (config.policies?.enforce === true) {
    return "enforce";
  }
  const definitions = config.policies?.definitions;
  if (config.security.mode === "policy" && definitions != null) {
    const list = normalizePolicyDefinitions(definitions);
    if (list.length > 0) {
      return "enforce";
    }
  }
  return "disabled";
}

function resolveTransportKind(
  transport: AthenaGatewayClient
): AthenaRuntimeCapabilities["transport"] {
  if (transport.baseUrl === ATHENA_PG_DIRECT_BASE_URL) {
    return "postgres-direct";
  }
  return "injected";
}

export function createAthenaServerRuntime(
  config: CreateAthenaServerRuntimeConfig
): AthenaServerRuntime {
  if (!config.security?.mode) {
    throw runtimeConfigError(
      "createAthenaServerRuntime requires an explicit security.mode."
    );
  }

  const injected = config.transport;
  const databaseUrl = resolveDatabaseUrl(config);
  if (!injected && !databaseUrl) {
    throw runtimeConfigError(
      "createAthenaServerRuntime requires databaseUrl or an injected transport."
    );
  }

  const transport =
    injected ??
    createPostgresDirectTransport({
      connectionString: databaseUrl as string,
      relationCatalog: catalogFromModels(config.models),
    });

  assertBrowserPolicyProfile(config);
  const rawSql = resolveFlag(config.rawSql);
  const rpc = resolveFlag(config.rpc);
  const rpcExpose = new Set(
    typeof config.rpc === "object" && Array.isArray(config.rpc.expose)
      ? config.rpc.expose
      : []
  );
  const hasModels = config.models !== undefined && config.models !== null;
  const modelEnforcement = resolveModelEnforcement({
    explicit: config.modelEnforcement,
    hasModels,
    securityMode: config.security.mode,
  });
  if (
    (modelEnforcement === "known-only" || modelEnforcement === "strict") &&
    !hasModels
  ) {
    throw runtimeConfigError(
      "ATHENA_MODEL_INVALID_REGISTRY: modelEnforcement requires models."
    );
  }
  const modelIndex = hasModels
    ? buildAthenaRuntimeModelIndex(config.models, modelEnforcement)
    : undefined;
  const authMaterial = normalizeAthenaRuntimeAuth(
    config.auth,
    config.security.mode,
    { databaseUrl }
  );
  const policyMode = resolvePolicyMode(config);
  let policyRegistry: AthenaServerRuntime["policyRegistry"];
  if (policyMode !== "disabled" || config.policies?.definitions != null) {
    try {
      policyRegistry = createPolicyRegistry({
        definitions: config.policies?.definitions ?? [],
        mode: policyMode,
        ...(modelIndex ? { modelIndex } : {}),
      });
    } catch (error) {
      if (error instanceof AthenaPolicyConfigError) {
        throw runtimeConfigError(error.message);
      }
      throw error;
    }
  }
  const capabilities: AthenaRuntimeCapabilities = {
    auth: authModeFromMaterial(authMaterial),
    modelEnforcement,
    nestedRelations: true,
    policies: policyMode !== "disabled",
    rawSql,
    rpc,
    security: config.security.mode,
    transport: resolveTransportKind(transport),
  };

  const allowsUnauthenticatedHttp = config.unsafeAllowUnauthenticated === true;
  const httpProfile = resolveAthenaRuntimeHttpProfile(config);

  const runtime: AthenaServerRuntime = {
    allowsUnauthenticatedHttp,
    authMaterial,
    capabilities,
    ...(config.discoveryDocument
      ? { discoveryDocument: config.discoveryDocument }
      : {}),
    httpProfile,
    ...(policyRegistry ? { policyRegistry } : {}),
    execute(request: AthenaRuntimeRequest, context?: AthenaRuntimeRequestContext) {
      return executeAthenaRequest(runtime, request, context);
    },
    modelIndex,
    ...(config.onExecutionEvent
      ? { onExecutionEvent: config.onExecutionEvent }
      : {}),
    rpcExpose,
    transport,
  };

  return runtime;
}
