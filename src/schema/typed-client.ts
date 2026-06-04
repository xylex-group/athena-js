import {
  createClient,
  type AthenaResult,
  type AthenaSdkClient,
  type RpcQueryBuilder,
  type TableQueryBuilder,
} from '../client.ts'
import type { AthenaGatewayCallOptions, AthenaJsonObject, AthenaRpcCallOptions } from '../gateway/types.ts'
import type {
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

type RegistryConstraint = RegistryDef<
  Record<string, DatabaseDef<Record<string, SchemaDef<Record<string, AnyModelDef>>>>>
>

/**
 * Options for creating typed Athena clients.
 */
export interface TypedClientOptions<TMap extends TenantKeyMap = TenantKeyMap>
  extends Pick<AthenaGatewayCallOptions, 'backend' | 'client' | 'headers'> {
  tenantKeyMap?: TMap
  tenantContext?: TenantContext<TMap>
}

/**
 * Typed Athena client with registry-driven model resolution and tenant-context propagation.
 */
export interface TypedAthenaClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
> extends AthenaSdkClient {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>
  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap>
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
    }
  >
}

type BaseClientOptions = Pick<AthenaGatewayCallOptions, 'backend' | 'client' | 'headers'>

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
    if (modelDef.meta.tableName) {
      return modelDef.meta.tableName
    }
    const schemaName = modelDef.meta.schema ?? schema
    const modelName = modelDef.meta.model ?? model
    return `${schemaName}.${modelName}`
  }
}

class TypedAthenaClientImpl<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap,
> implements TypedAthenaClient<TRegistry, TTenantMap> {
  readonly registry: TRegistry
  readonly tenantKeyMap: Readonly<TTenantMap>
  readonly tenantContext: TenantContext<TTenantMap>
  readonly db: AthenaSdkClient['db']

  private readonly baseClient: AthenaSdkClient
  private readonly registryNavigator: RegistryNavigator<TRegistry>
  private readonly tenantHeaderMapper: TenantHeaderMapper<TTenantMap>
  private readonly clientOptions: BaseClientOptions
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
    }

    this.baseClient = createClient(this.url, this.apiKey, {
      backend: this.clientOptions.backend,
      client: this.clientOptions.client,
      headers: this.tenantHeaderMapper.apply(this.clientOptions.headers, tenantContext),
    })
    this.db = this.baseClient.db
  }

  from<
    Row = Record<string, unknown>,
    Insert = Partial<Row>,
    Update = Partial<Insert>,
  >(table: string): TableQueryBuilder<Row, Insert, Update> {
    return this.baseClient.from<Row, Insert, Update>(table)
  }

  rpc<Row = unknown, Args extends AthenaJsonObject = AthenaJsonObject>(
    fn: string,
    args?: Args,
    options?: AthenaRpcCallOptions,
  ): RpcQueryBuilder<Row> {
    return this.baseClient.rpc<Row, Args>(fn, args, options)
  }

  query<Row = unknown>(
    query: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    return this.baseClient.query<Row>(query, options)
  }

  withTenantContext(context: TenantContext<TTenantMap>): TypedAthenaClient<TRegistry, TTenantMap> {
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
    }
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
      }
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
  options?: TypedClientOptions<TTenantMap>,
): TypedAthenaClient<TRegistry, TTenantMap> {
  return new TypedAthenaClientImpl({
    registry,
    url,
    apiKey,
    options,
  })
}

