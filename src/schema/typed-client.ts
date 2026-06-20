import {
  createClient,
  type AthenaCreateClientAuthOptions,
  type AthenaClientSessionLike,
  type AthenaClientSessionOptions,
  type AthenaClientContextOptions,
  type AthenaClientExperimentalOptions,
  type AthenaHeaderBag,
  type AthenaFromOptions,
  type AthenaResult,
  type AthenaSdkClient,
  type RpcQueryBuilder,
  type TableQueryBuilder,
} from '../client.ts'
import type {
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaJsonObject,
  AthenaRpcCallOptions,
} from '../gateway/types.ts'
import type {
  AthenaModelTarget,
  AnyModelDef,
  DatabaseDef,
  InsertOf,
  ModelAt,
  RegistryDef,
  RowOf,
  SchemaDef,
  TenantContext,
  TenantKeyMap,
  UpdateOf,
} from './types.ts'
import { resolveAthenaModelTargetTableName } from './model-target.ts'

type RegistryConstraint = RegistryDef<
  Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>
>

/**
 * Options for creating typed Athena clients.
 */
export interface TypedClientOptions<TMap extends TenantKeyMap = TenantKeyMap>
  extends Pick<
    AthenaGatewayCallOptions,
    'backend' | 'client' | 'headers' | 'forceNoCache' | 'userId' | 'organizationId'
  > {
  auth?: Omit<AthenaCreateClientAuthOptions, 'url' | 'baseUrl' | 'apiKey'>
  tenantKeyMap?: TMap
  tenantContext?: TenantContext<TMap>
  experimental?: AthenaClientExperimentalOptions
}

export interface TypedClientOptionsWithTypecheckedColumns<
  TMap extends TenantKeyMap = TenantKeyMap,
> extends TypedClientOptions<TMap> {
  experimental: AthenaClientExperimentalOptions & {
    typecheckColumns: true
  }
}

/**
 * Typed Athena client with registry-driven model resolution and tenant-context propagation.
 */
export interface TypedAthenaClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
  TStrict extends boolean = false,
> extends AthenaSdkClient<TStrict> {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>
  withContext(context?: AthenaClientContextOptions): TypedAthenaClient<TRegistry, TTenantMap, TStrict>
  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): TypedAthenaClient<TRegistry, TTenantMap, TStrict>
  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap, TStrict>
  fromModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
    TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): TableQueryBuilder<
    RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    {
      registry: TRegistry
      database: TDatabase
      schema: TSchema
      model: ModelAt<TRegistry, TDatabase, TSchema, TModel>
    },
    TStrict
  >
}

class TenantHeaderMapper<TMap extends TenantKeyMap> {
  constructor(private readonly tenantKeyMap: TMap) {}

  apply(
    baseHeaders: Record<string, string> | undefined,
    tenantContext: TenantContext<TMap>,
  ): Record<string, string> | undefined {
    const headers: Record<string, string> = {
      ...(baseHeaders ?? {}),
    }

    for (const [tenantKey, headerName] of Object.entries(this.tenantKeyMap)) {
      const tenantValue = tenantContext[tenantKey as keyof TMap]
      if (tenantValue === undefined || tenantValue === null) {
        continue
      }
      headers[headerName] = String(tenantValue)
    }

    return Object.keys(headers).length > 0 ? headers : undefined
  }
}

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : undefined
}

function readHeaderBagValue(
  headers: AthenaClientSessionOptions['requestHeaders'],
  targetKey: string,
): string | undefined {
  if (!headers) {
    return undefined
  }

  if (typeof (headers as AthenaHeaderBag).get === 'function') {
    return normalizeOptionalString((headers as AthenaHeaderBag).get(targetKey))
  }

  const normalizedTargetKey = targetKey.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedTargetKey) {
      continue
    }

    if (typeof value === 'string') {
      return normalizeOptionalString(value)
    }

    return undefined
  }

  return undefined
}

function resolveSessionContextOptions(
  session?: AthenaClientSessionLike | null,
  options?: AthenaClientSessionOptions,
): AthenaClientContextOptions | undefined {
  const sessionToken = normalizeOptionalString(session?.session?.token)
  const requestCookie =
    readHeaderBagValue(options?.requestHeaders, 'cookie') ??
    readHeaderBagValue(options?.headers, 'cookie')
  const authInput = options?.auth
  const resolvedUserId =
    options?.userId !== undefined ? options.userId : session?.user?.id
  const resolvedOrganizationId =
    options?.organizationId !== undefined
      ? options.organizationId
      : session?.session?.activeOrganizationId
  const resolvedBearerToken =
    authInput?.bearerToken !== undefined ? authInput.bearerToken : sessionToken
  const resolvedSessionToken =
    authInput?.sessionToken !== undefined ? authInput.sessionToken : sessionToken
  const resolvedCookie =
    authInput?.cookie !== undefined ? authInput.cookie : requestCookie

  const auth =
    authInput !== undefined ||
    resolvedBearerToken !== undefined ||
    resolvedSessionToken !== undefined ||
    resolvedCookie !== undefined
      ? {
          ...(authInput ?? {}),
          ...(resolvedBearerToken !== undefined
            ? { bearerToken: resolvedBearerToken }
            : {}),
          ...(resolvedSessionToken !== undefined
            ? { sessionToken: resolvedSessionToken }
            : {}),
          ...(resolvedCookie !== undefined ? { cookie: resolvedCookie } : {}),
          headers: authInput?.headers ? { ...authInput.headers } : undefined,
        }
      : undefined

  if (
    resolvedUserId === undefined &&
    resolvedOrganizationId === undefined &&
    options?.forceNoCache === undefined &&
    !options?.headers &&
    !auth
  ) {
    return undefined
  }

  return {
    userId: resolvedUserId,
    organizationId: resolvedOrganizationId,
    forceNoCache: options?.forceNoCache,
    headers: options?.headers ? { ...options.headers } : undefined,
    auth,
  }
}

class RegistryNavigator<TRegistry extends RegistryConstraint> {
  constructor(private readonly registry: TRegistry) {}

  resolveModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
    TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): ModelAt<TRegistry, TDatabase, TSchema, TModel> {
    const databaseDef = this.registry[database]
    if (!databaseDef) {
      throw new Error(`Unknown database "${database}"`)
    }

    const schemaDef = databaseDef.schemas[schema]
    if (!schemaDef) {
      throw new Error(`Unknown schema "${schema}" in database "${database}"`)
    }

    const modelDef = schemaDef.models[model]
    if (!modelDef) {
      throw new Error(`Unknown model "${model}" in schema "${schema}"`)
    }

    return modelDef as ModelAt<TRegistry, TDatabase, TSchema, TModel>
  }

  resolveTableName(
    schema: string,
    model: string,
    modelDef: AnyModelDef,
  ): string {
    return resolveAthenaModelTargetTableName(modelDef, {
      fallbackSchema: schema,
      fallbackModel: model,
    })
  }
}

class TypedAthenaClientImpl<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap,
  TStrict extends boolean = false,
> implements TypedAthenaClient<TRegistry, TTenantMap, TStrict> {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>
  readonly db: AthenaSdkClient<TStrict>['db']

  private readonly baseClient: AthenaSdkClient<TStrict>
  private readonly registryNavigator: RegistryNavigator<TRegistry>
  private readonly tenantHeaderMapper: TenantHeaderMapper<TTenantMap>
  private readonly clientOptions: TypedClientOptions<TTenantMap>
  private readonly url: string
  private readonly apiKey: string

  constructor(input: {
    registry: TRegistry
    url: string
    apiKey: string
    options?: TypedClientOptions<TTenantMap>
  }) {
    this.registry = input.registry
    this.url = input.url
    this.apiKey = input.apiKey

    const tenantKeyMap = (input.options?.tenantKeyMap ?? ({} as TTenantMap)) as TTenantMap
    const tenantContext = (input.options?.tenantContext ?? {}) as TenantContext<TTenantMap>

    this.tenantKeyMap = tenantKeyMap
    this.tenantContext = tenantContext
    this.tenantHeaderMapper = new TenantHeaderMapper(tenantKeyMap)
    this.registryNavigator = new RegistryNavigator(input.registry)

    this.clientOptions = {
      backend: input.options?.backend,
      client: input.options?.client,
      headers: input.options?.headers,
      forceNoCache: input.options?.forceNoCache,
      userId: input.options?.userId,
      organizationId: input.options?.organizationId,
      auth: input.options?.auth,
      tenantKeyMap,
      tenantContext,
      experimental: input.options?.experimental,
    }

    this.baseClient = createClient(this.url, this.apiKey, {
      backend: this.clientOptions.backend,
      client: this.clientOptions.client,
      headers: this.tenantHeaderMapper.apply(this.clientOptions.headers, tenantContext),
      forceNoCache: this.clientOptions.forceNoCache,
      userId: this.clientOptions.userId,
      organizationId: this.clientOptions.organizationId,
      auth: this.clientOptions.auth,
      experimental: this.clientOptions.experimental,
    }) as AthenaSdkClient<TStrict>
    this.db = this.baseClient.db
  }

  from<TModel extends AthenaModelTarget>(
    model: TModel,
  ): TableQueryBuilder<RowOf<TModel>, InsertOf<TModel>, UpdateOf<TModel>, unknown, TStrict>
  from<
    Row = Record<string, unknown>,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    table: string,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update, unknown, TStrict>
  from<
    Row = Record<string, unknown>,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(
    tableOrModel: string | AthenaModelTarget<Row, Insert, Update>,
    options?: AthenaFromOptions,
  ): TableQueryBuilder<Row, Insert, Update, unknown, TStrict> {
    const from = this.baseClient.from as unknown as (
      target: string | AthenaModelTarget<Row, Insert, Update>,
      options?: AthenaFromOptions,
    ) => TableQueryBuilder<Row, Insert, Update, unknown, TStrict>
    return from(tableOrModel, options)
  }

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row, TStrict> {
    return this.baseClient.rpc<Row, Args>(fn, args, options)
  }

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    return this.baseClient.query<Row>(query, options)
  }

  verifyConnection(
    options?: AthenaGatewayConnectionOptions,
  ): Promise<AthenaGatewayConnectionResult> {
    return this.baseClient.verifyConnection(options)
  }

  withContext(context?: AthenaClientContextOptions): TypedAthenaClient<TRegistry, TTenantMap, TStrict> {
    const headers = {
      ...(this.clientOptions.headers ?? {}),
      ...(context?.headers ?? {}),
    }
    const auth =
      this.clientOptions.auth || context?.auth
        ? {
            ...(this.clientOptions.auth ?? {}),
            ...(context?.auth ?? {}),
            headers:
              this.clientOptions.auth?.headers || context?.auth?.headers
                ? {
                    ...(this.clientOptions.auth?.headers ?? {}),
                    ...(context?.auth?.headers ?? {}),
                  }
                : undefined,
          }
        : undefined

    return new TypedAthenaClientImpl({
      registry: this.registry,
      url: this.url,
      apiKey: this.apiKey,
      options: {
        ...this.clientOptions,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        auth,
        tenantKeyMap: this.tenantKeyMap as TTenantMap,
        tenantContext: {
          ...this.tenantContext,
        },
        ...(context?.userId !== undefined ? { userId: context.userId } : {}),
        ...(context?.organizationId !== undefined
          ? { organizationId: context.organizationId }
          : {}),
        ...(context?.forceNoCache !== undefined
          ? { forceNoCache: context.forceNoCache }
          : {}),
      },
    })
  }

  withSession(
    session?: AthenaClientSessionLike | null,
    options?: AthenaClientSessionOptions,
  ): TypedAthenaClient<TRegistry, TTenantMap, TStrict> {
    return this.withContext(resolveSessionContextOptions(session, options))
  }

  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap, TStrict> {
    return new TypedAthenaClientImpl({
      registry: this.registry,
      url: this.url,
      apiKey: this.apiKey,
      options: {
        ...this.clientOptions,
        tenantKeyMap: this.tenantKeyMap as TTenantMap,
        tenantContext: {
          ...this.tenantContext,
          ...(context ?? {}),
        },
        experimental: this.clientOptions.experimental,
      },
    })
  }

  fromModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
    TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): TableQueryBuilder<
    RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
    {
      registry: TRegistry
      database: TDatabase
      schema: TSchema
      model: ModelAt<TRegistry, TDatabase, TSchema, TModel>
    },
    TStrict
  > {
    const modelDef = this.registryNavigator.resolveModel(database, schema, model)
    const tableName = this.registryNavigator.resolveTableName(schema, model, modelDef as AnyModelDef)
    return this.baseClient.from<
      RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
      InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
      UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>
    >(tableName) as TableQueryBuilder<
      RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
      InsertOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
      UpdateOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>,
      {
        registry: TRegistry
        database: TDatabase
        schema: TSchema
        model: ModelAt<TRegistry, TDatabase, TSchema, TModel>
      },
      TStrict
    >
  }
}

/**
 * Creates a typed client bound to a registry contract and optional tenant header mapping.
 */
export function createTypedClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
>(
  registry: TRegistry,
  url: string,
  apiKey: string,
  options: TypedClientOptionsWithTypecheckedColumns<TTenantMap>,
): TypedAthenaClient<TRegistry, TTenantMap, true>
export function createTypedClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
>(
  registry: TRegistry,
  url: string,
  apiKey: string,
  options?: TypedClientOptions<TTenantMap>,
): TypedAthenaClient<TRegistry, TTenantMap, false>
export function createTypedClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
>(
  registry: TRegistry,
  url: string,
  apiKey: string,
  options?: TypedClientOptions<TTenantMap>,
): TypedAthenaClient<TRegistry, TTenantMap, false> {
  return new TypedAthenaClientImpl({
    registry,
    url,
    apiKey,
    options,
  })
}

