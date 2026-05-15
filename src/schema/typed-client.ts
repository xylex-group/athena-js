import { createClient, type AthenaSdkClient, type TableQueryBuilder } from '../client.ts'
import type { AthenaGatewayCallOptions } from '../gateway/types.ts'
import type {
  DatabaseDef,
  ModelAt,
  ModelDef,
  ModelMetadata,
  RegistryDef,
  RowOf,
  SchemaDef,
  TenantContext,
  TenantKeyMap,
} from './types.ts'

type RegistryConstraint = RegistryDef<
  Record<
    string,
    DatabaseDef<Record<string, SchemaDef<Record<string, ModelDef<any, any, any, ModelMetadata<any>>>>>>
  >
>

export interface TypedClientOptions<TMap extends TenantKeyMap = TenantKeyMap>
  extends Pick<AthenaGatewayCallOptions, 'backend' | 'client' | 'headers'> {
  tenantKeyMap?: TMap
  tenantContext?: TenantContext<TMap>
}

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
  ): TableQueryBuilder<RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>>
}

function applyTenantHeaders<TMap extends TenantKeyMap>(
  baseHeaders: Record<string, string> | undefined,
  tenantKeyMap: TMap | undefined,
  tenantContext: TenantContext<TMap> | undefined,
): Record<string, string> | undefined {
  if (!tenantKeyMap || !tenantContext) {
    return baseHeaders
  }

  const headers: Record<string, string> = {
    ...(baseHeaders ?? {}),
  }

  for (const [tenantKey, headerName] of Object.entries(tenantKeyMap)) {
    const tenantValue = tenantContext[tenantKey as keyof TMap]
    if (tenantValue === undefined || tenantValue === null) {
      continue
    }
    headers[headerName] = String(tenantValue)
  }

  return headers
}

function resolveModelTableName(
  schemaKey: string,
  modelKey: string,
  modelDef: ModelDef<any, any, any, ModelMetadata<any>>,
): string {
  if (modelDef.meta.tableName) {
    return modelDef.meta.tableName
  }

  const schemaName = modelDef.meta.schema ?? schemaKey
  const modelName = modelDef.meta.model ?? modelKey
  return `${schemaName}.${modelName}`
}

export function createTypedClient<
  TRegistry extends RegistryConstraint,
  TTenantMap extends TenantKeyMap = Record<never, string>,
>(
  registry: TRegistry,
  url: string,
  apiKey: string,
  options?: TypedClientOptions<TTenantMap>,
): TypedAthenaClient<TRegistry, TTenantMap> {
  const tenantKeyMap = (options?.tenantKeyMap ?? ({} as TTenantMap)) as TTenantMap
  const tenantContext = (options?.tenantContext ?? {}) as TenantContext<TTenantMap>
  const tenantHeaders = applyTenantHeaders(
    options?.headers,
    tenantKeyMap,
    tenantContext,
  )

  const baseClient = createClient(url, apiKey, {
    backend: options?.backend,
    client: options?.client,
    headers: tenantHeaders,
  })

  const withTenantContext = (
    context: TenantContext<TTenantMap>,
  ): TypedAthenaClient<TRegistry, TTenantMap> =>
    createTypedClient(registry, url, apiKey, {
      ...options,
      tenantContext: {
        ...tenantContext,
        ...(context ?? {}),
      },
    })

  function fromModel<
    TDatabase extends keyof TRegistry & string,
    TSchema extends keyof TRegistry[TDatabase]['schemas'] & string,
    TModel extends keyof TRegistry[TDatabase]['schemas'][TSchema]['models'] & string,
  >(
    database: TDatabase,
    schema: TSchema,
    model: TModel,
  ): TableQueryBuilder<RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>> {
      const databaseDef = registry[database]
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

      const tableName = resolveModelTableName(schema, model, modelDef)
      return baseClient.from<RowOf<ModelAt<TRegistry, TDatabase, TSchema, TModel>>>(tableName)
    }

  const typedClient: TypedAthenaClient<TRegistry, TTenantMap> = {
    ...baseClient,
    registry,
    tenantKeyMap: tenantKeyMap as Readonly<TTenantMap>,
    tenantContext,
    withTenantContext,
    fromModel,
  }

  return typedClient
}
