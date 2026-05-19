import { createClient, type AthenaSdkClient } from '../client.ts'
import {
  buildGatewayCatalogQueries,
  PostgresCatalogSnapshotAssembler,
  type ColumnQueryRow,
  type EnumQueryRow,
  type ForeignKeyQueryRow,
  type PrimaryKeyQueryRow,
} from '../schema/postgres-introspection-core.ts'
import { createPostgresIntrospectionProvider } from '../schema/postgres-provider.ts'
import type {
  IntrospectionInspectOptions,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from '../schema/types.ts'
import type {
  GeneratorExperimentalFlags,
  GeneratorProviderConfig,
  PostgresDirectProviderConfig,
  PostgresGatewayProviderConfig,
  ScyllaDirectProviderConfig,
} from './types.ts'
import { normalizeSchemaSelection } from './schema-selection.ts'

class AthenaGatewayCatalogClient {
  constructor(private readonly client: AthenaSdkClient) {}

  async queryRows<T extends Record<string, unknown>>(query: string): Promise<T[]> {
    const result = await this.client.query<T>(query)
    if (result.error || result.status < 200 || result.status >= 300) {
      throw new Error(result.error ?? `Gateway query failed with status ${result.status}`)
    }
    return result.data ?? []
  }

  async queryColumns(query: string): Promise<ColumnQueryRow[]> {
    return this.queryRows<ColumnQueryRow>(query)
  }

  async queryEnums(query: string): Promise<Map<number, string[]>> {
    const rows = await this.queryRows<EnumQueryRow>(query)
    const enumMap = new Map<number, string[]>()
    for (const row of rows) {
      const existing = enumMap.get(row.type_oid) ?? []
      existing.push(row.enum_label)
      enumMap.set(row.type_oid, existing)
    }
    return enumMap
  }

  async queryPrimaryKeys(query: string): Promise<PrimaryKeyQueryRow[]> {
    return this.queryRows<PrimaryKeyQueryRow>(query)
  }

  async queryForeignKeys(query: string): Promise<ForeignKeyQueryRow[]> {
    return this.queryRows<ForeignKeyQueryRow>(query)
  }
}

class AthenaGatewayPostgresIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = 'postgresql' as const

  private readonly client: AthenaSdkClient
  private readonly schemas: string[]

  constructor(private readonly config: PostgresGatewayProviderConfig) {
    this.client = createClient(this.config.gatewayUrl, this.config.apiKey, {
      backend: {
        type: this.config.backend ?? 'postgresql',
      },
    })
    this.schemas = normalizeSchemaSelection(this.config.schemas)
  }

  async inspect(options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot> {
    const schemas =
      options?.schemas && options.schemas.length > 0
        ? normalizeSchemaSelection(options.schemas)
        : this.schemas

    const catalogClient = new AthenaGatewayCatalogClient(this.client)
    const queries = buildGatewayCatalogQueries(schemas)

    const [columnRows, enumMap, primaryKeyRows, foreignKeyRows] = await Promise.all([
      catalogClient.queryColumns(queries.columns),
      catalogClient.queryEnums(queries.enums),
      catalogClient.queryPrimaryKeys(queries.primaryKeys),
      catalogClient.queryForeignKeys(queries.foreignKeys),
    ])

    const assembler = new PostgresCatalogSnapshotAssembler()
    assembler.addColumnRows(columnRows, enumMap)
    assembler.addPrimaryKeyRows(primaryKeyRows)
    assembler.addForeignKeyRows(foreignKeyRows)
    assembler.addManyToManyRows(foreignKeyRows)

    return {
      backend: 'postgresql',
      database: this.config.database,
      generatedAt: new Date().toISOString(),
      schemas: assembler.toSchemas(),
    }
  }
}

class ScyllaIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = 'scylladb' as const

  constructor(private readonly config: ScyllaDirectProviderConfig) {}

  async inspect(): Promise<IntrospectionSnapshot> {
    throw new Error(
      `Scylla introspection provider is not implemented yet for keyspace ${this.config.keyspace}.`,
    )
  }
}

function createPostgresProvider(config: PostgresDirectProviderConfig): SchemaIntrospectionProvider {
  return createPostgresIntrospectionProvider({
    connectionString: config.connectionString,
    database: config.database,
    schemas: normalizeSchemaSelection(config.schemas),
  })
}

/**
 * Resolves a runtime introspection provider from generator config.
 */
export function resolveGeneratorProvider(
  providerConfig: GeneratorProviderConfig,
  experimentalFlags: GeneratorExperimentalFlags,
): SchemaIntrospectionProvider {
  if (providerConfig.kind === 'postgres' && providerConfig.mode === 'direct') {
    return createPostgresProvider(providerConfig)
  }

  if (providerConfig.kind === 'postgres' && providerConfig.mode === 'gateway') {
    return new AthenaGatewayPostgresIntrospectionProvider(providerConfig)
  }

  if (providerConfig.kind === 'scylla') {
    if (!experimentalFlags.scyllaProviderContracts) {
      throw new Error(
        'Scylla provider contracts are disabled. Set experimental.scyllaProviderContracts=true to enable placeholders.',
      )
    }
    return new ScyllaIntrospectionProvider(providerConfig)
  }

  throw new Error(`Unsupported generator provider kind: ${(providerConfig as { kind?: string }).kind ?? 'unknown'}`)
}
