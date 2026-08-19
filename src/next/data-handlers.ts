import type { AthenaRootClientBrand } from "../client-brands.ts";
import { athenaAuthConfig } from "../auth/config.ts";
import { AthenaConfigurationError } from "../config/errors.ts";
import type {
  AthenaRuntimeDiscoveryAuthAvailability,
  AthenaRuntimeDiscoveryDocument,
} from "../gateway/discovery-types.ts";
import { ATHENA_NEXT_RUNTIME_PROTOCOL } from "../gateway/protocol.ts";
import { handleAthenaGatewayRequest } from "../gateway/server/adapter.ts";
import {
  type AthenaClientInternals,
  requireAthenaRootClientInternals,
} from "../runtime/client-internals.ts";
import {
  DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT,
  DEFAULT_ATHENA_NEXT_DATA_ENDPOINT,
} from "../runtime/data/discovery-document.ts";
import { runtimeConfigError } from "../runtime/data/errors.ts";
import { createAthenaServerRuntime } from "../runtime/data/runtime.ts";
import type {
  AthenaRuntimeHttpSecurity,
  AthenaRuntimeSecurityMode,
  CreateAthenaServerRuntimeConfig,
} from "../runtime/data/types.ts";
import { resolveDatabaseUri } from "../runtime/resolve.ts";
/**
 * Structural root-client surface — avoid `AthenaClient` generics (TS2589).
 * The brand rejects `withContext` / `createAthenaServerClient` views at compile time.
 */
export interface AthenaRootClientForHandlers extends AthenaRootClientBrand {
  auth?: {
    handlers?: AthenaNextHandlers["auth"];
  };
  from: (...args: never[]) => unknown;
}

export interface CreateAthenaDataHandlersFromClient {
  auth?: CreateAthenaServerRuntimeConfig["auth"];
  client: AthenaRootClientForHandlers;
  discoveryDocument?: CreateAthenaServerRuntimeConfig["discoveryDocument"];
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
    throw new AthenaConfigurationError(
      "ATHENA_LOCAL_RUNTIME_REQUIRED",
      "createAthenaDataHandlers({ client }) requires a root client with a local database transport (databaseUrl / db.pgUri).",
      "db"
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
    ...(options.discoveryDocument
      ? { discoveryDocument: options.discoveryDocument }
      : {}),
  };
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Advertise Auth from the resolved plan + explicit routing on the root. */
function advertiseAuthFromRootPlan(
  internals: AthenaClientInternals,
  client: AthenaRootClientForHandlers
): AthenaRuntimeDiscoveryAuthAvailability & { endpoint?: string } {
  const runtime = internals.plan.auth.runtime;
  if (runtime === "disabled") {
    return { available: false };
  }
  if (runtime === "embedded") {
    return {
      available: true,
      endpoint: DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT,
      transport: "same-origin",
    };
  }
  const auth = athenaAuthConfig(internals.config.auth);
  const routing = auth?.routing;
  const explicitUrl = auth?.url?.trim();
  if (routing === "same-origin") {
    return {
      available: true,
      endpoint: DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT,
      transport: "same-origin",
    };
  }
  if (explicitUrl && isAbsoluteHttpUrl(explicitUrl)) {
    return { available: true, transport: "remote" };
  }
  if ((client.auth as { handlers?: unknown } | undefined)?.handlers) {
    return {
      available: true,
      endpoint: DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT,
      transport: "same-origin",
    };
  }
  return { available: false };
}

function createUnavailableAuthHandlers(): AthenaNextHandlers["auth"] {
  const handle = async (): Promise<Response> =>
    new Response(JSON.stringify({ error: "ATHENA_AUTH_NOT_AVAILABLE" }), {
      headers: { "content-type": "application/json" },
      status: 404,
    });
  return {
    DELETE: handle,
    GET: handle,
    POST: handle,
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
  const internals = requireAthenaRootClientInternals(
    config.client,
    "createAthenaNextHandlers({ client })"
  );
  const advertised = advertiseAuthFromRootPlan(internals, config.client);
  const existing = (
    config.client.auth as { handlers?: AthenaNextHandlers["auth"] } | undefined
  )?.handlers;
  const auth = existing ?? createUnavailableAuthHandlers();
  const discoveryDocument: AthenaRuntimeDiscoveryDocument = {
    athena: true,
    capabilities: {
      auth: advertised.available
        ? {
            available: true,
            ...(advertised.transport
              ? { transport: advertised.transport }
              : {}),
          }
        : { available: false },
      data: true,
      delete: true,
      fetch: true,
      insert: true,
      models: "off",
      nestedRelations: false,
      policy: false,
      rawSql: false,
      rpc: false,
      update: true,
    },
    endpoints: {
      data: DEFAULT_ATHENA_NEXT_DATA_ENDPOINT,
      ...(advertised.available && advertised.endpoint
        ? { auth: advertised.endpoint }
        : {}),
    },
    protocol: {
      major: ATHENA_NEXT_RUNTIME_PROTOCOL.major,
      minor: ATHENA_NEXT_RUNTIME_PROTOCOL.minor,
    },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
  };
  return {
    auth,
    data: createAthenaDataHandlers({
      ...config,
      discoveryDocument,
    }),
  };
}
