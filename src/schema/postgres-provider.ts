import type { Pool } from 'pg'
import type {
  IntrospectionInspectOptions,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from './types.ts'
import {
  type ColumnQueryRow,
  type EnumQueryRow,
  type ForeignKeyQueryRow,
  type PrimaryKeyQueryRow,
  POSTGRES_CATALOG_SQL,
  normalizePostgresCatalogSchemas,
  PostgresCatalogSnapshotAssembler,
} from './postgres-introspection-core.ts'

/**
 * Constructor options for the PostgreSQL introspection provider.
 */
export interface PostgresIntrospectionProviderOptions {
  connectionString: string
  database?: string
  schemas?: readonly string[]
}

type PgPoolConstructor = new (config: { connectionString: string }) => Pool

let pgPoolConstructorPromise: Promise<PgPoolConstructor> | undefined

async function loadPgPoolConstructor(): Promise<PgPoolConstructor> {
  if (!pgPoolConstructorPromise) {
    pgPoolConstructorPromise = import('pg').then(module => {
      const poolConstructor =
        (module as { Pool?: PgPoolConstructor }).Pool ??
        (module as { default?: { Pool?: PgPoolConstructor } }).default?.Pool

      if (!poolConstructor) {
        throw new Error(
          '@xylex-group/athena: Unable to load the PostgreSQL driver. Ensure "pg" is installed and this API runs in a Node.js server runtime.',
        )
      }

      return poolConstructor
    })
  }

  return pgPoolConstructorPromise
}

class PgCatalogClient {
  constructor(private readonly pool: Pool) {}

  async queryColumns(schemas: string[]): Promise<ColumnQueryRow[]> {
    const result = await this.pool.query<ColumnQueryRow>(POSTGRES_CATALOG_SQL.columns, [schemas])
    return result.rows
  }

  async queryEnums(): Promise<Map<number, string[]>> {
    const result = await this.pool.query<EnumQueryRow>(POSTGRES_CATALOG_SQL.enums)
    const enumMap = new Map<number, string[]>()
    for (const row of result.rows) {
      const existing = enumMap.get(row.type_oid) ?? []
      existing.push(row.enum_label)
      enumMap.set(row.type_oid, existing)
    }
    return enumMap
  }

  async queryPrimaryKeys(schemas: string[]): Promise<PrimaryKeyQueryRow[]> {
    const result = await this.pool.query<PrimaryKeyQueryRow>(POSTGRES_CATALOG_SQL.primaryKeys, [schemas])
    return result.rows
  }

  async queryForeignKeys(schemas: string[]): Promise<ForeignKeyQueryRow[]> {
    const result = await this.pool.query<ForeignKeyQueryRow>(POSTGRES_CATALOG_SQL.foreignKeys, [schemas])
    return result.rows
  }
}

class PostgresIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = 'postgresql' as const

  private readonly connectionString: string
  private readonly database: string
  private readonly schemas: string[]

  constructor(options: PostgresIntrospectionProviderOptions) {
    this.connectionString = options.connectionString
    this.database = options.database ?? 'postgres'
    this.schemas = normalizePostgresCatalogSchemas(options.schemas)
  }

  async inspect(options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot> {
    const schemas = options?.schemas && options.schemas.length > 0
      ? normalizePostgresCatalogSchemas(options.schemas)
      : this.schemas
    const PoolConstructor = await loadPgPoolConstructor()
    const pool = new PoolConstructor({
      connectionString: this.connectionString,
    })
    const catalogClient = new PgCatalogClient(pool)

    try {
      const [columnRows, enumMap, primaryKeyRows, foreignKeyRows] = await Promise.all([
        catalogClient.queryColumns(schemas),
        catalogClient.queryEnums(),
        catalogClient.queryPrimaryKeys(schemas),
        catalogClient.queryForeignKeys(schemas),
      ])

      const assembler = new PostgresCatalogSnapshotAssembler()
      assembler.addColumnRows(columnRows, enumMap)
      assembler.addPrimaryKeyRows(primaryKeyRows)
      assembler.addForeignKeyRows(foreignKeyRows)
      assembler.addManyToManyRows(foreignKeyRows)

      return {
        backend: 'postgresql',
        database: this.database,
        generatedAt: new Date().toISOString(),
        schemas: assembler.toSchemas(),
      }
    } finally {
      await pool.end()
    }
  }
}

/**
 * Creates a PostgreSQL-backed schema introspection provider.
 */
export function createPostgresIntrospectionProvider(
  options: PostgresIntrospectionProviderOptions,
): SchemaIntrospectionProvider {
  return new PostgresIntrospectionProvider(options)
}
