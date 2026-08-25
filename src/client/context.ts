/**
 * Internal Athena client composition root.
 *
 * Feature modules consume {@link AthenaClientRuntimeContext} /
 * {@link InternalAthenaClientCore}, not the public AthenaClient façade.
 * Browser-safe: must not import pg, node:fs, server-only, or v3-client.ts.
 */

import type {
  AthenaAdminQueryInput,
  AthenaAdminQueryResult,
} from "../admin/query.ts";
import { createAdminQuery } from "../admin/query.ts";
import { createAuthModule } from "../auth/client.ts";
import { toAthenaAuthDiagnostics } from "../auth/resolve-routing.ts";
import type {
  AthenaAuthBindings,
  AthenaAuthClientConfig,
} from "../auth/types.ts";
import { createChatModule } from "../chat/module.ts";
import type {
  AthenaChatModule,
  AthenaChatWebSocketFactory,
} from "../chat/types.ts";
import type {
  AthenaRequestOptions,
  AthenaRequestResponse,
} from "../client-request.ts";
import { createAthenaRequest } from "../client-request.ts";
import type {
  AthenaResult,
  AthenaResultFormatter,
} from "../client-result.ts";
import { createResultFormatter } from "../client-result.ts";
import { resolveTableNameForCall } from "../client-sql.ts";
import type {
  AthenaFromOptions,
  AthenaRowShape,
  ClientTableQueryBuilder,
  InternalClientBehaviorOptions,
  RpcQueryBuilder,
  TableQueryBuilder,
  UntypedTableName,
} from "../client-fluent.ts";
import {
  createQueryBuilder,
  createRpcBuilder,
  createTableBuilder,
} from "../client-fluent.ts";
import {
  type AthenaCompatibilityCache,
  type AthenaCompatibilityReport,
  createCompatibilityCache,
  discoverCompatibility,
} from "../compatibility/report.ts";
import type { AthenaDbModule, AthenaTransactionClient } from "../db/module.ts";
import {
  beginInteractiveSession,
  executeAtomicTransaction,
  finishInteractiveSession,
  nextInternalSavepointName,
} from "../db/transaction/index.ts";
import { AthenaTransactionError } from "../db/transaction/errors.ts";
import { createInteractiveGatewayClient } from "../db/transaction/interactive-gateway.ts";
import type { AthenaTransactionOptions } from "../db/transaction/types.ts";
import {
  type AthenaGatewayClient,
  createAthenaGatewayClient,
  createAthenaGatewayClientView,
} from "../gateway/client.ts";
import { normalizeAthenaGatewayBaseUrl } from "../gateway/url.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaJsonObject,
  AthenaRpcCallOptions,
  BackendConfig,
} from "../gateway/types.ts";
import type { AthenaCacheContextDescriptor } from "../query/descriptor.ts";
import { peekSyncCacheContext } from "../query/descriptor.ts";
import type { AthenaQueryTracer } from "../query-tracing.ts";
import {
  captureTraceCallsite,
  createQueryTracer,
} from "../query-tracing.ts";
import type {
  AthenaNormalizedHealth,
  AthenaReleaseIdentity,
} from "../release/identity.ts";
import {
  isAthenaModelTarget,
  resolveAthenaModelTargetTableName,
} from "../schema/model-target.ts";
import type {
  AthenaClientModelsInput,
  AthenaClientTableName,
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from "../schema/types.ts";
import type { AthenaSelectInput } from "../select-column-types.ts";
import type {
  AthenaStorageClientConfig,
  AthenaStorageModule,
} from "../storage/module.ts";
import { createStorageModule } from "../storage/module.ts";
import type { AthenaRequestHeaderOverrideFields } from "../utils/athena-request-headers.ts";

/**
 * Composition root consumed by SDK modules (alias of InternalAthenaClientCore).
 * Public AthenaClient is a frozen façade assembled over this context.
 */
export type AthenaClientRuntimeContext<
  TModels extends AthenaClientModelsInput | never = never,
> = InternalAthenaClientCore<TModels>;

export interface AthenaClientAdminModule {
  /**
   * Explicit raw SQL with operation + expected shape metadata.
   * Preferred over root `query()` for Dragunov / Athena 5.
   */
  query: <T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(
    input: AthenaAdminQueryInput<TParams>,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaAdminQueryResult<T>>;
}

export interface AthenaClientSystemModule {
  /** Lazy cached compatibility report (health-backed when available). */
  compatibility: () => Promise<AthenaCompatibilityReport>;
  /**
   * Redacted runtime plan (database / auth / storage / environment).
   * Diagnostics only — not a configuration surface.
   */
  runtime: () => import("../runtime/resolve.ts").AthenaRuntimeDiagnostics;
  /**
   * Safe auth routing / configuration snapshot (no secrets, tokens, or cookie values).
   * Always installed by `createClient` / `createClientView` (4.3+). Does not require db.
   */
  inspectAuth: (options?: {
    requestOrigin?: string | null;
  }) => import("../auth/resolve-routing.ts").AthenaAuthDiagnostics;
  /** Normalized release identity from health (Athena 4 synthesizes without codename). */
  release: () => Promise<AthenaReleaseIdentity>;
}

export interface InternalAthenaClient<TModels = never> {
  admin: AthenaClientAdminModule;
  auth: AthenaAuthBindings;
  chat: AthenaChatModule;
  db: AthenaDbModule<TModels>;
  from<TModel extends AthenaModelTarget>(
    model: TModel
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>>;
  from<TTableName extends AthenaClientTableName<TModels>>(
    table: TTableName,
    options?: AthenaFromOptions
  ): ClientTableQueryBuilder<TModels, TTableName>;
  from<Row = AthenaRowShape, Insert = Partial<Row>, Update = Partial<Insert>>(
    table: UntypedTableName<TModels>,
    options?: AthenaFromOptions
  ): TableQueryBuilder<Row, Insert, Update>;
  /**
   * GET /health (fallback GET /) with release identity normalization.
   */
  health: () => Promise<AthenaNormalizedHealth>;
  /**
   * Executes raw SQL through Athena's compatibility query surface.
   *
   * @deprecated Prefer `admin.query()` with explicit `operation` and `expectedShape`.
   */
  query: <Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaResult<Row[]>>;
  request: <T = unknown>(
    options: AthenaRequestOptions
  ) => Promise<AthenaRequestResponse<T>>;
  rpc: <Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions
  ) => RpcQueryBuilder<Row>;
  storage: AthenaStorageModule;
  system: AthenaClientSystemModule;
  verifyConnection: (
    options?: AthenaGatewayConnectionOptions
  ) => Promise<AthenaGatewayConnectionResult>;
}

export interface InternalClientChatOptions
  extends Pick<
    AthenaRequestHeaderOverrideFields,
    "bearerToken" | "cookie" | "forceNoCache" | "headers" | "sessionToken"
  > {
  webSocketFactory?: AthenaChatWebSocketFactory | null | undefined;
  wsUrl?: string | null | undefined;
}

export type InternalClientAuthOptions = Omit<
  AthenaAuthClientConfig,
  "baseUrl" | "apiKey" | "bearerToken" | "cookie" | "sessionToken"
>;

export interface InternalClientConfig<
  TModels extends AthenaClientModelsInput | never = never,
> {
  apiKey: string;
  auth?: InternalClientAuthOptions;
  authUrl?: string;
  backend?: BackendConfig;
  baseUrl: string;
  behavior?: InternalClientBehaviorOptions;
  chat?: InternalClientChatOptions;
  chatUrl?: string;
  chatWsUrl?: string;
  client?: string | null | undefined;
  /**
   * Optional prebuilt gateway transport (HTTP client, Cloudflare D1 local, or test fake).
   * When set, `createAthenaGatewayClient` is not constructed from baseUrl/apiKey.
   * @see ADR 0015
   */
  gatewayTransport?: AthenaGatewayClient;
  headers?: Record<string, string>;
  jdbcUrl?: string | null | undefined;
  models?: TModels;
  /** Direct PostgreSQL URI forwarded as `x-pg-uri` on gateway requests. */
  pgUri?: string | null | undefined;
  storage?: AthenaStorageClientConfig;
  storageUrl?: string;
}

export interface InternalClientRequestContext {
  accessScope?: string | null;
  bearerToken?: string | null;
  cookie?: string | null;
  forceNoCache?: boolean;
  headers?: Record<string, string>;
  organizationId?: string | null;
  policyRevision?: string | null;
  sessionToken?: string | null;
  userId?: string | null;
}

export type InternalClientContextResolver = () =>
  | InternalClientRequestContext
  | undefined
  | Promise<InternalClientRequestContext | undefined>;

export interface InternalAthenaClientCore<
  TModels extends AthenaClientModelsInput | never = never,
> {
  readonly config: InternalClientConfig<TModels>;
  readonly formatGatewayResult: AthenaResultFormatter;
  readonly gatewayTransport: AthenaGatewayClient;
  readonly normalizedAuthConfig: AthenaAuthClientConfig | undefined;
  readonly queryTracer: AthenaQueryTracer | undefined;
}

function buildContextHeaders(
  context: InternalClientRequestContext
): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (
    context.userId !== undefined &&
    context.userId !== null &&
    context.userId !== ""
  ) {
    headers["X-User-Id"] = context.userId;
  }
  if (
    context.organizationId !== undefined &&
    context.organizationId !== null &&
    context.organizationId !== ""
  ) {
    headers["X-Organization-Id"] = context.organizationId;
  }
  Object.assign(headers, context.headers);
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/**
 * Normalize auth base for the auth module.
 *
 * Absolute http(s) URLs are validated like gateway bases (no query/hash).
 * Relative same-origin paths (e.g. `/api/auth`) are preserved — auth is not
 * a gateway URL and must not go through absolute-only gateway normalization.
 */
function normalizeAuthClientBaseUrl(defaultBaseUrl: string): string {
  const trimmed = defaultBaseUrl.trim();
  if (!trimmed) {
    throw new Error(
      'Athena auth base URL must be a non-empty absolute http(s) URL or a path such as "/api/auth".'
    );
  }

  // Same-origin / relative browser bases used by auth.routing "same-origin".
  if (trimmed.startsWith("/")) {
    return trimmed.replace(/\/+$/, "") || "/";
  }

  return normalizeAthenaGatewayBaseUrl(trimmed, {
    label: "Athena auth base URL",
  });
}

function normalizeAuthClientConfig(
  auth: InternalClientAuthOptions | undefined,
  defaultBaseUrl?: string
): AthenaAuthClientConfig | undefined {
  if (!auth && defaultBaseUrl === undefined) {
    return;
  }

  const normalized: AthenaAuthClientConfig = {
    ...(auth ?? {}),
  };
  const resolvedBaseUrl =
    defaultBaseUrl !== undefined && defaultBaseUrl !== ""
      ? normalizeAuthClientBaseUrl(defaultBaseUrl)
      : undefined;

  if (resolvedBaseUrl !== undefined) {
    normalized.baseUrl = resolvedBaseUrl;
  }
  return normalized;
}

export function createInternalClientCore<
  TModels extends AthenaClientModelsInput | never = never,
>(config: InternalClientConfig<TModels>): InternalAthenaClientCore<TModels> {
  const normalizedAuthConfig = normalizeAuthClientConfig(
    config.auth,
    config.authUrl
  );
  const gatewayTransport =
    config.gatewayTransport ??
    createAthenaGatewayClient({
      apiKey: config.apiKey,
      backend: config.backend,
      baseUrl: config.baseUrl,
      client: config.client ?? undefined,
      headers: config.headers,
      jdbcUrl: config.jdbcUrl,
      pgUri: config.pgUri,
    });
  return Object.freeze({
    config,
    formatGatewayResult: createResultFormatter(),
    gatewayTransport,
    normalizedAuthConfig,
    queryTracer: createQueryTracer(config.behavior),
  });
}

export function createInternalClientView<
  TModels extends AthenaClientModelsInput | never = never,
>(
  core: InternalAthenaClientCore<TModels>,
  resolveContext: InternalClientContextResolver,
  cacheContext?: AthenaCacheContextDescriptor
): InternalAthenaClient<TModels> {
  const { config, formatGatewayResult, normalizedAuthConfig, queryTracer } =
    core;
  const gateway = createAthenaGatewayClientView(
    core.gatewayTransport,
    async () => {
      const context = await resolveContext();
      return context
        ? {
            bearerToken: context.bearerToken,
            cookie: context.cookie,
            forceNoCache: context.forceNoCache,
            headers: context.headers,
            organizationId: context.organizationId,
            sessionToken: context.sessionToken,
            userId: context.userId,
          }
        : undefined;
    }
  );
  const auth = createAuthModule(
    {
      ...(normalizedAuthConfig ?? {}),
    },
    {
      async resolveCallOptions() {
        const context = await resolveContext();
        return context
          ? {
              bearerToken: context.bearerToken ?? undefined,
              cookie: context.cookie ?? undefined,
              forceNoCache: context.forceNoCache,
              headers: buildContextHeaders(context),
              sessionToken: context.sessionToken ?? undefined,
            }
          : undefined;
      },
    }
  );
  // Single implementation + cast avoids TS2589 deep overload expansion during dts.
  const from = ((
    tableOrModel: string | AthenaModelTarget,
    options?: AthenaFromOptions
  ) => {
    if (isAthenaModelTarget(tableOrModel)) {
      if (options?.schema !== undefined) {
        throw new Error(
          "from(model) does not accept a schema override because the model already defines its target."
        );
      }
      return createTableBuilder(
        resolveAthenaModelTargetTableName(tableOrModel),
        gateway,
        formatGatewayResult,
        queryTracer,
        config.behavior,
        {
          cacheContext: cacheContext ?? peekSyncCacheContext(resolveContext),
          model: tableOrModel,
        }
      );
    }

    const resolvedTableName = resolveTableNameForCall(
      tableOrModel,
      options?.schema
    );
    return createTableBuilder(
      resolvedTableName,
      gateway,
      formatGatewayResult,
      queryTracer,
      config.behavior,
      {
        cacheContext: cacheContext ?? peekSyncCacheContext(resolveContext),
      }
    );
  }) as AthenaDbModule<TModels>["from"];
  const rpc: InternalAthenaClient<TModels>["rpc"] = <
    Row = unknown,
    Args extends AthenaJsonObject = AthenaJsonObject,
  >(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions
  ) => {
    const normalizedFn = fn.trim();
    if (!normalizedFn) {
      throw new Error("rpc requires a function name");
    }
    return createRpcBuilder<Row>(
      normalizedFn,
      args as AthenaJsonObject | undefined,
      options,
      gateway,
      formatGatewayResult,
      queryTracer,
      captureTraceCallsite(queryTracer),
      Boolean(config.behavior?.debugAst)
    );
  };
  const deprecationOwner = Object.create(null) as object;
  const compatibilityCache: AthenaCompatibilityCache =
    createCompatibilityCache();
  const adminQueryImpl = createAdminQuery({
    client: gateway,
    formatGatewayResult,
  });
  const admin: AthenaClientAdminModule = {
    query: adminQueryImpl,
  };
  const query = createQueryBuilder(
    gateway,
    formatGatewayResult,
    config.behavior,
    queryTracer,
    deprecationOwner
  ) as InternalAthenaClient<TModels>["query"];
  const health = async (): Promise<AthenaNormalizedHealth> => {
    const report = await discoverCompatibility({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      cache: compatibilityCache,
      headers: config.headers,
    });
    if (compatibilityCache.health) {
      return compatibilityCache.health;
    }
    return {
      message: null,
      raw: null,
      release: report.release,
      status: null,
      version:
        report.server.version === "unknown" ? null : report.server.version,
    };
  };
  const system: AthenaClientSystemModule = {
    async compatibility() {
      return discoverCompatibility({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        cache: compatibilityCache,
        headers: config.headers,
      });
    },
    runtime() {
      return {
        auth: "remote",
        database: "gateway",
        runtime: "node",
        storage: "none",
      };
    },
    /**
     * Internal/core path has no routing SSOT attachment; return empty diagnostics.
     * Public createClient views always supply a real inspectAuth via v3 createClientView.
     */
    inspectAuth(options?: { requestOrigin?: string | null }) {
      return toAthenaAuthDiagnostics(undefined, {
        requestOrigin: options?.requestOrigin,
      });
    },
    async release() {
      const report = await system.compatibility();
      return report.release;
    },
  };
  const untypedDbFrom = from as unknown as <
    Row = AthenaRowShape,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    options?: AthenaFromOptions
  ) => TableQueryBuilder<Row, Insert, Update>;

  const createTransactionScopedDb = (
    txGateway: ReturnType<typeof createAthenaGatewayClient>,
    session: import("../db/transaction/coordinator.ts").InteractiveTransactionSession
  ): AthenaTransactionClient<TModels> => {
    const txFrom = ((
      tableOrModel: string | AthenaModelTarget,
      options?: AthenaFromOptions
    ) => {
      if (isAthenaModelTarget(tableOrModel)) {
        return createTableBuilder(
          resolveAthenaModelTargetTableName(tableOrModel),
          txGateway,
          formatGatewayResult,
          queryTracer,
          config.behavior,
          { model: tableOrModel }
        );
      }
      return createTableBuilder(
        resolveTableNameForCall(tableOrModel, options?.schema),
        txGateway,
        formatGatewayResult,
        queryTracer,
        config.behavior
      );
    }) as AthenaDbModule<TModels>["from"];
    const txUntypedFrom = txFrom as unknown as typeof untypedDbFrom;
    const scoped = {
      abort() {
        session.abort();
      },
      delete(table: string, options?: AthenaGatewayCallOptions & { resourceId?: string }) {
        return txUntypedFrom(table).delete(options);
      },
      from: txFrom,
      insert(table: string, values: unknown, options?: AthenaGatewayCallOptions) {
        return Array.isArray(values)
          ? txUntypedFrom(table).insert(values as never, options)
          : txUntypedFrom(table).insert(values as never, options);
      },
      select(
        table: string,
        first?: AthenaGatewayCallOptions | AthenaSelectInput,
        second?: AthenaGatewayCallOptions
      ) {
        if (first && typeof first === "object" && !Array.isArray(first)) {
          return txUntypedFrom(table).select(
            undefined,
            first as AthenaGatewayCallOptions
          );
        }
        return txUntypedFrom(table).select(
          first as AthenaSelectInput | undefined,
          second
        );
      },
      update(table: string, values: unknown, options?: AthenaGatewayCallOptions) {
        return txUntypedFrom(table).update(values as never, options);
      },
      upsert(table: string, values: unknown, options?: AthenaGatewayCallOptions) {
        return Array.isArray(values)
          ? txUntypedFrom(table).upsert(values as never, options)
          : txUntypedFrom(table).upsert(values as never, options);
      },
      async withSavepoint(callback: (tx: unknown) => Promise<unknown>) {
        if (!session.transport.createSavepoint) {
          throw new AthenaTransactionError(
            "ATHENA_TRANSACTION_SAVEPOINT_UNSUPPORTED",
            `Savepoints are not supported by backend "${session.capabilities.backend}"`,
            { backend: session.capabilities.backend }
          );
        }
        session.savepointIndex += 1;
        const name = nextInternalSavepointName(session.savepointIndex);
        await session.transport.createSavepoint(name);
        try {
          const value = await callback(scoped);
          await session.transport.releaseSavepoint?.(name);
          return value;
        } catch (error) {
          await session.transport.rollbackToSavepoint?.(name);
          throw error;
        }
      },
      async withTransaction(callback: (tx: unknown) => Promise<unknown>) {
        if (!session.capabilities.savepoints) {
          throw new AthenaTransactionError(
            "ATHENA_TRANSACTION_NESTING_UNSUPPORTED",
            `Nested withTransaction is not supported by backend "${session.capabilities.backend}"`,
            { backend: session.capabilities.backend }
          );
        }
        return scoped.withSavepoint(callback) as Promise<unknown>;
      },
    };
    return scoped as unknown as AthenaTransactionClient<TModels>;
  };

  const db = {
    delete<Row = AthenaRowShape>(
      table: string,
      options?: AthenaGatewayCallOptions & { resourceId?: string }
    ) {
      return untypedDbFrom<Row>(table).delete(options);
    },
    from,
    insert<Row = AthenaRowShape, Insert = Partial<Row>>(
      table: string,
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions
    ) {
      return Array.isArray(values)
        ? untypedDbFrom<Row, Insert, Partial<Insert>>(table).insert(
            values,
            options
          )
        : untypedDbFrom<Row, Insert, Partial<Insert>>(table).insert(
            values,
            options
          );
    },
    query,
    rpc,
    select<Row = AthenaRowShape>(
      table: string,
      first?: AthenaGatewayCallOptions | AthenaSelectInput,
      second?: AthenaGatewayCallOptions
    ) {
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return untypedDbFrom<Row>(table).select(
          undefined,
          first as AthenaGatewayCallOptions
        );
      }
      return untypedDbFrom<Row>(table).select(
        first as AthenaSelectInput | undefined,
        second
      );
    },
    update<
      Row = AthenaRowShape,
      Insert = Partial<Row>,
      Update = Partial<Insert>,
    >(table: string, values: Update, options?: AthenaGatewayCallOptions) {
      return untypedDbFrom<Row, Insert, Update>(table).update(values, options);
    },
    upsert<
      Row = AthenaRowShape,
      Insert = Partial<Row>,
      Update = Partial<Insert>,
    >(
      table: string,
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions & {
        updateBody?: Update;
        onConflict?: string | string[];
      }
    ) {
      return Array.isArray(values)
        ? untypedDbFrom<Row, Insert, Update>(table).upsert(values, options)
        : untypedDbFrom<Row, Insert, Update>(table).upsert(values, options);
    },
    transaction(operations, options?: AthenaTransactionOptions) {
      return executeAtomicTransaction({
        formatGatewayResult,
        gateway,
        operations,
        options,
      });
    },
    async withTransaction(callback, options?: AthenaTransactionOptions) {
      const session = await beginInteractiveSession({
        gateway,
        options,
      });
      const txGateway = createInteractiveGatewayClient(gateway, session);
      const tx = createTransactionScopedDb(txGateway, session);
      try {
        const value = await callback(tx);
        await finishInteractiveSession({
          committedOperations: [],
          committedResults: [],
          session,
        });
        return value;
      } catch (error) {
        try {
          await session.transport.rollback();
        } catch {
          // Prefer the original error.
        }
        throw error;
      }
    },
  } as AthenaDbModule<TModels>;
  const chat = createChatModule(
    {
      apiKey: config.apiKey,
      baseUrl: config.chatUrl,
      bearerToken: config.chat?.bearerToken ?? undefined,
      client: config.client ?? undefined,
      cookie: config.chat?.cookie ?? undefined,
      forceNoCache: config.chat?.forceNoCache ?? undefined,
      headers: {
        ...(config.headers ?? {}),
        ...(config.chat?.headers ?? {}),
      },
      sessionToken: config.chat?.sessionToken ?? undefined,
      webSocketFactory: config.chat?.webSocketFactory ?? undefined,
      wsUrl: config.chatWsUrl,
    },
    {
      async resolveCallOptions() {
        const context = await resolveContext();
        return context
          ? {
              bearerToken: context.bearerToken,
              cookie: context.cookie,
              forceNoCache: context.forceNoCache,
              headers: buildContextHeaders(context),
              sessionToken: context.sessionToken,
            }
          : undefined;
      },
    }
  );
  const request = createAthenaRequest(config, resolveContext);
  const storage = createStorageModule(gateway, {
    ...config.storage,
    ...(config.storageUrl
      ? {
          baseUrl: config.storageUrl,
          stripBasePath: true,
        }
      : {}),
  });

  return {
    admin,
    auth: auth.auth,
    chat,
    db,
    from,
    health,
    query,
    request,
    rpc,
    storage,
    system,
    verifyConnection: gateway.verifyConnection,
  } as InternalAthenaClient<TModels>;
}
