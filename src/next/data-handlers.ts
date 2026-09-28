import { athenaAuthConfig } from "../auth/config.ts";
import type { AthenaRootClientBrand } from "../client-brands.ts";
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
  createAthenaSessionAuthFromStores,
  readAuthRightsProjection,
} from "../runtime/data/athena-session.ts";
import {
  DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT,
  DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT,
  DEFAULT_ATHENA_NEXT_DATA_ENDPOINT,
  DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT,
  DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
} from "../runtime/data/discovery-document.ts";
import { runtimeConfigError } from "../runtime/data/errors.ts";
import { createAthenaServerRuntime } from "../runtime/data/runtime.ts";
import type {
  AthenaRuntimeHttpSecurity,
  AthenaRuntimeSecurityMode,
  CreateAthenaServerRuntimeConfig,
} from "../runtime/data/types.ts";
import type { AthenaRuntimeJwtVerifier } from "../runtime/data/principal.ts";
import { resolveDatabaseUri } from "../runtime/resolve.ts";
import { getStorageProvider } from "../storage/runtime/index.ts";
import {
  type AthenaBillingHandlers,
  createAthenaBillingHandlers,
} from "./billing-handlers.ts";
import {
  type AthenaBillingIngressHandlers,
  createAthenaBillingIngressHandlers,
  DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT,
} from "./billing-ingress-handlers.ts";
import {
  type AthenaNotificationsHandlers,
  createAthenaNotificationsHandlers,
} from "./notifications-handlers.ts";
import { buildAthenaRuntimeDiscoveryDiagnostics } from "./runtime-discovery-diagnostics.ts";
import { projectCapabilitiesToDiscovery } from "../runtime/data/capabilities-projection.ts";
import {
  type AthenaStorageHandlers,
  createAthenaStorageHandlers,
} from "./storage-handlers.ts";
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
  oauth?: CreateAthenaServerRuntimeConfig["oauth"];
  policies?: CreateAthenaServerRuntimeConfig["policies"];
  /** Resource URI expected in OAuth access-token audiences for this handler. */
  resource?: string;
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

export interface AthenaNextHandler extends AthenaDataHandlers {
  HEAD: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
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
  billing: AthenaBillingHandlers;
  billingIngress: AthenaBillingIngressHandlers;
  data: AthenaDataHandlers;
  notifications: AthenaNotificationsHandlers;
  storage: AthenaStorageHandlers;
}

function isFromClientConfig(
  config: CreateAthenaDataHandlersConfig
): config is CreateAthenaDataHandlersFromClient {
  return (
    typeof (config as CreateAthenaDataHandlersFromClient).client === "object" &&
    (config as CreateAthenaDataHandlersFromClient).client !== null
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
  if (options.security?.mode === undefined && !policyMode && !embedded) {
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
    let oauthVerifierPromise: Promise<AthenaRuntimeJwtVerifier> | undefined;
    const jwtVerifier: AthenaRuntimeJwtVerifier | undefined =
      options.resource && internals.authRuntime?.getOAuthRuntimeJwtVerifier
        ? async (input) => {
            oauthVerifierPromise ??= internals.authRuntime?.getOAuthRuntimeJwtVerifier?.(
              options.resource as string
            );
            return (await oauthVerifierPromise)?.(input) ?? null;
          }
        : undefined;
    auth = createAthenaSessionAuthFromStores({
      authorization: readAuthRightsProjection(internals.config),
      getStores: internals.getAuthStores,
      ...(jwtVerifier ? { jwtVerifier } : {}),
    });
  }

  const clientConfig = internals.config as unknown;
  return {
    ...(auth === undefined ? {} : { auth }),
    ...(internals.authorizationConfig
      ? { authorizationConfig: internals.authorizationConfig }
      : {}),
    ...(internals.authorizationModelIndex
      ? { authorizationModelIndex: internals.authorizationModelIndex }
      : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(clientConfig &&
    typeof clientConfig === "object" &&
    !Array.isArray(clientConfig)
      ? { devtoolsProduceInput: clientConfig as Record<string, unknown> }
      : {}),
    devtoolsClientInternals: internals,
    capabilitiesIr: internals.capabilitiesIr,
    ...(internals.config.lifecycle
      ? { lifecycle: internals.config.lifecycle }
      : {}),
    ...(options.limits ? { limits: options.limits } : {}),
    ...(options.modelEnforcement
      ? { modelEnforcement: options.modelEnforcement }
      : {}),
    ...(models === undefined ? {} : { models }),
    ...(options.oauth ? { oauth: options.oauth } : {}),
    ...(policies ? { policies } : {}),
    ...(options.resource ? { resource: options.resource } : {}),
    ...(options.rawSql === undefined ? {} : { rawSql: options.rawSql }),
    ...(options.rpc === undefined ? {} : { rpc: options.rpc }),
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

const UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT = `${DEFAULT_ATHENA_NEXT_DATA_ENDPOINT}/auth`;

/** Advertise Auth from the resolved plan + explicit routing on the root. */
function advertiseAuthFromRootPlan(
  internals: AthenaClientInternals,
  client: AthenaRootClientForHandlers,
  sameOriginEndpoint: string = DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT
): AthenaRuntimeDiscoveryAuthAvailability & { endpoint?: string } {
  const runtime = internals.plan.auth.runtime;
  if (runtime === "disabled") {
    return { available: false };
  }
  if (runtime === "embedded") {
    return {
      available: true,
      endpoint: sameOriginEndpoint,
      transport: "same-origin",
    };
  }
  const auth = athenaAuthConfig(internals.config.auth);
  const routing = auth?.routing;
  const explicitUrl = auth?.url?.trim();
  if (routing === "same-origin") {
    return {
      available: true,
      endpoint: sameOriginEndpoint,
      transport: "same-origin",
    };
  }
  if (explicitUrl && isAbsoluteHttpUrl(explicitUrl)) {
    return {
      available: true,
      endpoint: explicitUrl,
      transport: "remote",
    };
  }
  if ((client.auth as { handlers?: unknown } | undefined)?.handlers) {
    return {
      available: true,
      endpoint: sameOriginEndpoint,
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

/**
 * Next.js App Router handlers for Embedded Auth, Data, Storage, and Billing.
 *
 * Pass a root client from `@xylex-group/athena/server`. Do not pass a
 * request-scoped client.
 *
 * @docsCanonical
 * @docsRuntime node
 * @docsRole next-handlers
 * @docsRequires athena-root-client
 * @docsForbids athena-request-client
 * @docsRelated createClient
 * @since 5.0.0
 */
export function createAthenaNextHandlers(
  config: CreateAthenaNextHandlersConfig
): AthenaNextHandlers {
  return createAthenaNextHandlersForMount(
    config,
    DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT
  );
}

function createAthenaNextHandlersForMount(
  config: CreateAthenaNextHandlersConfig,
  sameOriginAuthEndpoint: string
): AthenaNextHandlers {
  const internals = requireAthenaRootClientInternals(
    config.client,
    "createAthenaNextHandlers({ client })"
  );
  const advertised = advertiseAuthFromRootPlan(
    internals,
    config.client,
    sameOriginAuthEndpoint
  );
  const advertisedAuthPath = advertised.available
    ? (advertised.endpoint ?? sameOriginAuthEndpoint)
    : undefined;
  const hasStorageRuntime = Boolean(
    internals.storageRuntime || getStorageProvider(internals.config.storage)
  );
  const hasBillingRuntime = Boolean(internals.billingRuntime);
  const existing = (
    config.client.auth as { handlers?: AthenaNextHandlers["auth"] } | undefined
  )?.handlers;
  const auth = existing ?? createUnavailableAuthHandlers();
  const projectedCapabilities = internals.capabilitiesIr
    ? projectCapabilitiesToDiscovery(internals.capabilitiesIr, {
        auth: advertised.available
          ? {
              available: true,
              ...(advertised.transport
                ? { transport: advertised.transport }
                : {}),
            }
          : { available: false },
        billing: hasBillingRuntime,
        data: true,
        delete: true,
        fetch: true,
        insert: true,
        models: "off",
        nestedRelations: false,
        policy: false,
        rawSql: false,
        rpc: false,
        storage: hasStorageRuntime,
        update: true,
      })
    : undefined;
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
      billing: hasBillingRuntime,
      billingIngress: hasBillingRuntime ? { webhook: true } : undefined,
      data: projectedCapabilities?.data ?? true,
      delete: projectedCapabilities?.delete ?? true,
      fetch: projectedCapabilities?.fetch ?? true,
      insert: projectedCapabilities?.insert ?? true,
      models: projectedCapabilities?.models ?? "off",
      nestedRelations: projectedCapabilities?.nestedRelations ?? false,
      notifications: true,
      policy: projectedCapabilities?.policy ?? false,
      rawSql: projectedCapabilities?.rawSql ?? false,
      rpc: projectedCapabilities?.rpc ?? false,
      storage: projectedCapabilities?.storage ?? hasStorageRuntime,
      update: projectedCapabilities?.update ?? true,
    },
    diagnostics: buildAthenaRuntimeDiscoveryDiagnostics(internals),
    endpoints: {
      data: DEFAULT_ATHENA_NEXT_DATA_ENDPOINT,
      ...(hasStorageRuntime
        ? { storage: DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT }
        : {}),
      ...(hasBillingRuntime
        ? { billing: DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT }
        : {}),
      notifications: DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT,
      ...(advertisedAuthPath ? { auth: advertisedAuthPath } : {}),
    },
    protocol: {
      major: ATHENA_NEXT_RUNTIME_PROTOCOL.major,
      minor: ATHENA_NEXT_RUNTIME_PROTOCOL.minor,
    },
    runtime: "next-local",
    runtimeImplementation: "athena-js",
    transports: {
      data: {
        credentials: "same-origin",
        kind: "http",
        origin: "same-origin",
        path: DEFAULT_ATHENA_NEXT_DATA_ENDPOINT,
      },
      ...(advertisedAuthPath
        ? {
            auth: {
              credentials:
                advertised.transport === "remote" ? "none" : "same-origin",
              kind: "http" as const,
              origin: advertised.transport ?? "same-origin",
              path: advertisedAuthPath,
            },
          }
        : {}),
      ...(hasStorageRuntime
        ? {
            storage: {
              credentials: "same-origin",
              kind: "http" as const,
              origin: "same-origin",
              path: DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT,
            },
          }
        : {}),
      ...(hasBillingRuntime
        ? {
            billing: {
              credentials: "same-origin",
              kind: "http" as const,
              origin: "same-origin",
              path: DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT,
            },
          }
        : {}),
      notifications: {
        credentials: "same-origin",
        kind: "http" as const,
        origin: "same-origin",
        path: DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT,
      },
    },
  };
  return {
    auth,
    billing: createAthenaBillingHandlers({
      ...(config.auth === undefined ? {} : { auth: config.auth }),
      client: config.client,
      discoveryDocument,
      security: config.security,
    }),
    billingIngress: createAthenaBillingIngressHandlers({
      client: config.client,
    }),
    data: createAthenaDataHandlers({
      ...config,
      discoveryDocument,
    }),
    notifications: createAthenaNotificationsHandlers({
      ...(config.auth === undefined ? {} : { auth: config.auth }),
      client: config.client,
      discoveryDocument,
      security: config.security,
    }),
    storage: createAthenaStorageHandlers({
      ...(config.auth === undefined ? {} : { auth: config.auth }),
      client: config.client,
      discoveryDocument,
      security: config.security,
    }),
  };
}

export type CreateAthenaNextHandlerConfig =
  | CreateAthenaNextHandlersConfig
  | { handlers: AthenaNextHandlers };

type AthenaRouteHandler = (request: Request) => Promise<Response>;

const ATHENA_ROUTE_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "OPTIONS",
  "PATCH",
  "POST",
  "PUT",
] as const;

type AthenaRouteMethod = (typeof ATHENA_ROUTE_METHODS)[number];

type AthenaRouteSurface = {
  [Method in AthenaRouteMethod]?: AthenaRouteHandler;
};

function isAthenaRouteMethod(value: string): value is AthenaRouteMethod {
  return (ATHENA_ROUTE_METHODS as readonly string[]).includes(value);
}

function routePathname(request: Request): string {
  try {
    return new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return "/";
  }
}

function matchesRoute(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function matchesAuthRoute(pathname: string): boolean {
  return (
    matchesRoute(pathname, DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT) ||
    matchesRoute(pathname, UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT)
  );
}

function rewriteUnifiedAuthRequest(request: Request): Request {
  const pathname = routePathname(request);
  if (!matchesRoute(pathname, UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT)) {
    return request;
  }
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return request;
  }
  const suffix = pathname.slice(UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT.length);
  url.pathname = `${DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT}${suffix}`;
  return new Request(url, request);
}

function invokeRouteHandler(
  surface: AthenaRouteSurface | undefined,
  request: Request
): Promise<Response> {
  const method = request.method.toUpperCase();
  const handler = isAthenaRouteMethod(method) ? surface?.[method] : undefined;
  if (!handler) {
    return Promise.resolve(new Response(null, { status: 405 }));
  }
  return handler(request);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rewriteSplitAuthDiscoveryDocument(value: unknown): unknown {
  if (!isJsonObject(value) || value.athena !== true) {
    return value;
  }
  const endpoints = isJsonObject(value.endpoints) ? value.endpoints : undefined;
  const transports = isJsonObject(value.transports)
    ? value.transports
    : undefined;
  const authTransport = isJsonObject(transports?.auth)
    ? transports.auth
    : undefined;
  const rewriteEndpoints =
    endpoints?.auth === DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT;
  const rewriteTransportPath =
    authTransport?.path === DEFAULT_ATHENA_NEXT_AUTH_ENDPOINT &&
    authTransport.origin !== "remote";
  if (!(rewriteEndpoints || rewriteTransportPath)) {
    return value;
  }
  return {
    ...value,
    ...(rewriteEndpoints && endpoints
      ? {
          endpoints: {
            ...endpoints,
            auth: UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT,
          },
        }
      : {}),
    ...(rewriteTransportPath && transports && authTransport
      ? {
          transports: {
            ...transports,
            auth: {
              ...authTransport,
              path: UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT,
            },
          },
        }
      : {}),
  };
}

async function rewriteSplitAuthDiscoveryResponse(
  response: Response
): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("json")) {
    return response;
  }
  const snapshot = response.clone();
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return snapshot;
  }
  const rewritten = rewriteSplitAuthDiscoveryDocument(value);
  if (rewritten === value) {
    return snapshot;
  }
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return new Response(JSON.stringify(rewritten), {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function isDiscoveryPath(pathname: string): boolean {
  return pathname.endsWith("/capabilities") || pathname.endsWith("/health");
}

export function createAthenaNextHandler(
  config: CreateAthenaNextHandlerConfig
): AthenaNextHandler {
  const prebuiltHandlers =
    "handlers" in config && config.handlers ? config.handlers : undefined;
  const handlers =
    prebuiltHandlers ??
    createAthenaNextHandlersForMount(
      config as CreateAthenaNextHandlersConfig,
      UNIFIED_ATHENA_NEXT_AUTH_ENDPOINT
    );
  const dispatch = (request: Request): Promise<Response> => {
    const pathname = routePathname(request);
    let response: Promise<Response>;
    if (matchesRoute(pathname, DEFAULT_ATHENA_NEXT_BILLING_WEBHOOK_ENDPOINT)) {
      response = invokeRouteHandler(handlers.billingIngress, request);
    } else if (matchesRoute(pathname, DEFAULT_ATHENA_NEXT_STORAGE_ENDPOINT)) {
      response = invokeRouteHandler(handlers.storage, request);
    } else if (matchesRoute(pathname, DEFAULT_ATHENA_NEXT_BILLING_ENDPOINT)) {
      response = invokeRouteHandler(handlers.billing, request);
    } else if (
      matchesRoute(pathname, DEFAULT_ATHENA_NEXT_NOTIFICATIONS_ENDPOINT)
    ) {
      response = invokeRouteHandler(handlers.notifications, request);
    } else if (matchesAuthRoute(pathname)) {
      response = invokeRouteHandler(
        handlers.auth,
        rewriteUnifiedAuthRequest(request)
      );
    } else {
      response = invokeRouteHandler(handlers.data, request);
    }
    if (prebuiltHandlers && isDiscoveryPath(pathname)) {
      return response.then(rewriteSplitAuthDiscoveryResponse);
    }
    return response;
  };
  return {
    DELETE: dispatch,
    GET: dispatch,
    HEAD: dispatch,
    OPTIONS: dispatch,
    PATCH: dispatch,
    POST: dispatch,
    PUT: dispatch,
  };
}
