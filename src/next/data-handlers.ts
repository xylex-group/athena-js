import { handleAthenaGatewayRequest } from "../gateway/server/adapter.ts";
import { requireAthenaRootClientInternals } from "../runtime/client-internals.ts";
import { runtimeConfigError } from "../runtime/data/errors.ts";
import { createAthenaServerRuntime } from "../runtime/data/runtime.ts";
import type {
  AthenaRuntimeHttpSecurity,
  AthenaRuntimeSecurityMode,
  CreateAthenaServerRuntimeConfig,
} from "../runtime/data/types.ts";
import { resolveDatabaseUri } from "../runtime/resolve.ts";
/** Structural root-client surface — avoid `AthenaClient` generics (TS2589). */
export interface AthenaRootClientForHandlers {
  auth?: {
    handlers?: AthenaNextHandlers["auth"];
  };
  from: (...args: never[]) => unknown;
}

export interface CreateAthenaDataHandlersFromClient {
  auth?: CreateAthenaServerRuntimeConfig["auth"];
  client: AthenaRootClientForHandlers;
  http?: boolean | AthenaRuntimeHttpSecurity;
  limits?: CreateAthenaServerRuntimeConfig["limits"];
  modelEnforcement?: CreateAthenaServerRuntimeConfig["modelEnforcement"];
  models?: unknown;
  policies?: CreateAthenaServerRuntimeConfig["policies"];
  rawSql?: CreateAthenaServerRuntimeConfig["rawSql"];
  rpc?: CreateAthenaServerRuntimeConfig["rpc"];
  security?: {
    http?: AthenaRuntimeHttpSecurity;
    mode?: AthenaRuntimeSecurityMode;
  };
  unsafeAllowUnauthenticated?: boolean;
}

export type CreateAthenaDataHandlersConfig =
  | CreateAthenaServerRuntimeConfig
  | CreateAthenaDataHandlersFromClient;

export type CreateAthenaNextHandlersConfig = CreateAthenaDataHandlersFromClient;

export interface AthenaDataHandlers {
  DELETE: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

export interface AthenaNextHandlers {
  auth: {
    DELETE: (request: Request) => Promise<Response>;
    GET: (request: Request) => Promise<Response>;
    HEAD?: (request: Request) => Promise<Response>;
    OPTIONS?: (request: Request) => Promise<Response>;
    PATCH?: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
    PUT?: (request: Request) => Promise<Response>;
  };
  data: AthenaDataHandlers;
}

function isFromClientConfig(
  config: CreateAthenaDataHandlersConfig
): config is CreateAthenaDataHandlersFromClient {
  return (
    typeof (config as CreateAthenaDataHandlersFromClient).client === "object" &&
    (config as CreateAthenaDataHandlersFromClient).client !== null &&
    typeof (config as CreateAthenaDataHandlersFromClient).client.from ===
      "function"
  );
}

function hasPolicyDefinitions(
  policies: CreateAthenaServerRuntimeConfig["policies"] | undefined
): boolean {
  const definitions = policies?.definitions;
  if (definitions == null) {
    return false;
  }
  if (Array.isArray(definitions)) {
    return definitions.length > 0;
  }
  if (typeof definitions === "object") {
    return Object.keys(definitions).length > 0;
  }
  return true;
}

function deriveRuntimeConfigFromRoot(
  options: CreateAthenaDataHandlersFromClient
): CreateAthenaServerRuntimeConfig {
  const internals = requireAthenaRootClientInternals(
    options.client,
    "createAthenaDataHandlers({ client })"
  );
  const policies = options.policies ?? internals.config.policies;
  const models = options.models ?? internals.config.models;
  const databaseUrl = resolveDatabaseUri(internals.config);
  const transport =
    internals.plan.db.transport === "postgres"
      ? internals.gatewayTransport
      : undefined;
  if (!(transport || databaseUrl)) {
    throw runtimeConfigError(
      "createAthenaDataHandlers({ client }) requires a root client with a local database transport (databaseUrl / db.pgUri)."
    );
  }

  const policyMode = hasPolicyDefinitions(policies);
  const embedded = internals.plan.auth.runtime === "embedded";
  if (
    options.security?.mode === undefined &&
    !policyMode &&
    !embedded
  ) {
    throw runtimeConfigError(
      "createAthenaDataHandlers({ client }) could not infer security.mode. Pass policies, use embedded Auth, or set security.mode (trusted requires unsafeAllowUnauthenticated)."
    );
  }
  const securityMode: AthenaRuntimeSecurityMode =
    options.security?.mode ?? (policyMode ? "policy" : "authenticated");
  const httpSecurity =
    options.security?.http ??
    (typeof options.http === "object" ? options.http : undefined);

  let auth = options.auth;
  if (auth === undefined && embedded && internals.getAuthStores) {
    const getStores = internals.getAuthStores;
    auth = {
      mode: "athena-session",
      stores: {
        getSessionByToken: async (token) => {
          const stores = await getStores();
          return stores.getSessionByToken(token);
        },
        getUserById: async (id) => {
          const stores = await getStores();
          return stores.getUserById(id);
        },
      },
    };
  }

  return {
    ...(auth !== undefined ? { auth } : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.modelEnforcement
      ? { modelEnforcement: options.modelEnforcement }
      : {}),
    ...(models !== undefined ? { models } : {}),
    ...(policies ? { policies } : {}),
    ...(options.rawSql !== undefined ? { rawSql: options.rawSql } : {}),
    ...(options.rpc !== undefined ? { rpc: options.rpc } : {}),
    security: {
      ...(httpSecurity ? { http: httpSecurity } : {}),
      mode: securityMode,
    },
    ...(transport ? { transport } : {}),
    ...(options.unsafeAllowUnauthenticated === true
      ? { unsafeAllowUnauthenticated: true }
      : {}),
  };
}

/**
 * Next.js App Router L1. Resolves a Local Runtime and serves the canonical
 * Gateway HTTP contract. Does not compile SQL or apply policy semantics.
 */
export function createAthenaDataHandlers(
  config: CreateAthenaDataHandlersConfig
): AthenaDataHandlers {
  const resolved = isFromClientConfig(config)
    ? deriveRuntimeConfigFromRoot(config)
    : config;

  if (
    resolved.security?.mode === "trusted" &&
    resolved.unsafeAllowUnauthenticated !== true
  ) {
    throw runtimeConfigError(
      'createAthenaDataHandlers({ security: { mode: "trusted" } }) requires unsafeAllowUnauthenticated: true for HTTP-reachable handlers.'
    );
  }

  const runtime = createAthenaServerRuntime({
    ...resolved,
    http: true,
    unsafeAllowUnauthenticated: resolved.unsafeAllowUnauthenticated === true,
  });

  const handle = (request: Request): Promise<Response> =>
    handleAthenaGatewayRequest(request, runtime);

  return {
    DELETE: handle,
    GET: handle,
    PATCH: handle,
    POST: handle,
  };
}

export function createAthenaNextHandlers(
  config: CreateAthenaNextHandlersConfig
): AthenaNextHandlers {
  const auth = (config.client.auth as { handlers?: AthenaNextHandlers["auth"] })
    .handlers;
  if (!auth) {
    throw runtimeConfigError(
      "createAthenaNextHandlers({ client }) requires root-client auth.handlers. Pass a Node createClient root with embedded or remote Auth."
    );
  }
  return {
    auth,
    data: createAthenaDataHandlers(config),
  };
}
