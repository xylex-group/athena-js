import {
  type AthenaPostgresPool,
  createPostgresPool,
} from "../postgres/driver.ts";
import {
  type ColumnQueryRow,
  type EnumQueryRow,
  type ForeignKeyQueryRow,
  type IndexQueryRow,
  normalizePostgresCatalogSchemas,
  POSTGRES_CATALOG_SQL,
  PostgresCatalogSnapshotAssembler,
  type PrimaryKeyQueryRow,
  type UniqueConstraintQueryRow,
} from "./postgres-introspection-core.ts";
import type {
  IntrospectionInspectOptions,
  IntrospectionSnapshot,
  SchemaIntrospectionProvider,
} from "./types.ts";

/**
 * Constructor options for the PostgreSQL introspection provider.
 */
export interface PostgresIntrospectionProviderOptions {
  connectionString: string;
  database?: string;
  schemas?: readonly string[];
}

class PgCatalogClient {
  constructor(private readonly pool: AthenaPostgresPool) {}

  async queryColumns(schemas: string[]): Promise<ColumnQueryRow[]> {
    const result = await this.pool.query<ColumnQueryRow>(
      POSTGRES_CATALOG_SQL.columns,
      [schemas]
    );
    return result.rows;
  }

  async queryEnums(): Promise<Map<number, string[]>> {
    const result = await this.pool.query<EnumQueryRow>(
      POSTGRES_CATALOG_SQL.enums
    );
    const enumMap = new Map<number, string[]>();
    for (const row of result.rows) {
      const existing = enumMap.get(row.type_oid) ?? [];
      existing.push(row.enum_label);
      enumMap.set(row.type_oid, existing);
    }
    return enumMap;
  }

  async queryPrimaryKeys(schemas: string[]): Promise<PrimaryKeyQueryRow[]> {
    const result = await this.pool.query<PrimaryKeyQueryRow>(
      POSTGRES_CATALOG_SQL.primaryKeys,
      [schemas]
    );
    return result.rows;
  }

  async queryForeignKeys(schemas: string[]): Promise<ForeignKeyQueryRow[]> {
    const result = await this.pool.query<ForeignKeyQueryRow>(
      POSTGRES_CATALOG_SQL.foreignKeys,
      [schemas]
    );
    return result.rows;
  }

  async queryUniqueConstraints(
    schemas: string[]
  ): Promise<UniqueConstraintQueryRow[]> {
    const result = await this.pool.query<UniqueConstraintQueryRow>(
      POSTGRES_CATALOG_SQL.uniqueConstraints,
      [schemas]
    );
    return result.rows;
  }

  async queryIndexes(schemas: string[]): Promise<IndexQueryRow[]> {
    const result = await this.pool.query<IndexQueryRow>(
      POSTGRES_CATALOG_SQL.indexes,
      [schemas]
    );
    return result.rows;
  }
}

class PostgresIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = "postgresql" as const;

  private readonly connectionString: string;
  private readonly database: string;
  private readonly schemas: string[];

  constructor(options: PostgresIntrospectionProviderOptions) {
    this.connectionString = options.connectionString;
    this.database = options.database ?? "postgres";
    this.schemas = normalizePostgresCatalogSchemas(options.schemas);
  }

  async inspect(
    options?: IntrospectionInspectOptions
  ): Promise<IntrospectionSnapshot> {
    const schemas =
          options?.schemas && options.schemas.length > 0
            ? normalizePostgresCatalogSchemas(options.schemas)
            : this.schemas;
        const pool = await createPostgresPool(this.connectionString);
        const catalogClient = new PgCatalogClient(pool);

    try {
      const [
        columnRows,
        enumMap,
        primaryKeyRows,
        foreignKeyRows,
        uniqueRows,
        indexRows,
      ] = await Promise.all([
        catalogClient.queryColumns(schemas),
        catalogClient.queryEnums(),
        catalogClient.queryPrimaryKeys(schemas),
        catalogClient.queryForeignKeys(schemas),
        catalogClient.queryUniqueConstraints(schemas),
        catalogClient.queryIndexes(schemas),
      ]);

      const assembler = new PostgresCatalogSnapshotAssembler();
      assembler.addColumnRows(columnRows, enumMap);
      assembler.addPrimaryKeyRows(primaryKeyRows);
      assembler.addForeignKeyRows(foreignKeyRows);
      assembler.addUniqueConstraintRows(uniqueRows);
      assembler.addIndexRows(indexRows);
      assembler.addManyToManyRows(foreignKeyRows);

      return {
        backend: "postgresql",
        database: this.database,
        generatedAt: new Date().toISOString(),
        schemas: assembler.toSchemas(),
      };
    } finally {
      await pool.end();
    }
  }
}

/**
 * Creates a PostgreSQL-backed schema introspection provider.
 */
export function createPostgresIntrospectionProvider(
  options: PostgresIntrospectionProviderOptions
): SchemaIntrospectionProvider {
  return new PostgresIntrospectionProvider(options);
}
