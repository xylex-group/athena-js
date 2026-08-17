import { POSTGRES_CATALOG_SQL } from "../schema/postgres-introspection-core.ts";
// Browser-safe client core: this module is re-exported from the browser entry,
// so it must not reach the Node-only direct PostgreSQL transport.
import { type AthenaClient, createClient } from "../v3-client-core.ts";
import type {
  AthenaTableCatalogColumn,
  AthenaTableCatalogRelation,
  AthenaTableCatalogResponse,
  AthenaTableCatalogTable,
  AthenaTableSchemaConfig,
} from "./types.ts";

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: boolean;
  schema_name: string;
  table_name: string;
}

interface PrimaryKeyRow {
  columns: string[] | string;
  schema_name: string;
  table_name: string;
}

interface ForeignKeyRow {
  constraint_name: string;
  source_columns: string[] | string;
  source_schema: string;
  source_table: string;
  target_columns: string[] | string;
  target_schema: string;
  target_table: string;
}

type MutableRelation = Omit<AthenaTableCatalogRelation, "columns">;

type MutableTableCatalog = Omit<AthenaTableCatalogTable, "relations"> & {
  relationMap: Map<string, MutableRelation>;
};

/** Minimal query surface used by the catalog (v3 client or compatible). */
export interface AthenaTableCatalogQueryClient {
  query: AthenaClient["query"];
}

export interface FetchAthenaTableCatalogOptions {
  /**
   * Optional pre-built client. When omitted, a short-lived client is created
   * from `config.gatewayUrl`, `config.gatewayKey`, and `config.clientName`.
   */
  client?: AthenaTableCatalogQueryClient;
}

/**
 * Parse a comma-separated schema scope into unique non-empty names.
 */
export function parseAthenaTableSchemaScope(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(
      (entry, index, values) =>
        entry.length > 0 && values.indexOf(entry) === index
    );
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''");
}

function buildSchemaArrayLiteral(schemas: readonly string[]) {
  const literals = schemas
    .map((schema) => `'${escapeSqlLiteral(schema)}'`)
    .join(", ");

  return `ARRAY[${literals}]`;
}

function inlineSchemaLiteral(sql: string, schemas: readonly string[]) {
  return sql.replace(
    /\$1::text\[\]/g,
    `${buildSchemaArrayLiteral(schemas)}::text[]`
  );
}

/**
 * Build gateway SQL for columns, primary keys, and foreign keys for the
 * given schema list (parameter placeholders inlined for gateway SQL).
 */
export function buildAthenaTableCatalogQueries(schemas: readonly string[]) {
  return {
    columns: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.columns, schemas),
    foreignKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.foreignKeys, schemas),
    primaryKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.primaryKeys, schemas),
  };
}

function tableKey(schema: string, table: string) {
  return `${schema}.${table}`;
}

function relationKey(...parts: string[]) {
  const base = parts
    .join("_")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return base.length > 0 ? base : "relation";
}

function parsePostgresArrayLiteral(text: string) {
  const body = text.slice(1, -1).trim();

  if (!body) {
    return [];
  }

  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  let escaped = false;

  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);

  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function coerceStringArray(value: string[] | string | null | undefined) {
  if (value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return [];
  }

  if (trimmedValue.startsWith("{") && trimmedValue.endsWith("}")) {
    return parsePostgresArrayLiteral(trimmedValue);
  }

  return trimmedValue
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createTableCatalog() {
  const tables = new Map<string, MutableTableCatalog>();

  const ensureTable = (schema: string, name: string) => {
    const id = tableKey(schema, name);
    const existingTable = tables.get(id);

    if (existingTable) {
      return existingTable;
    }

    const nextTable: MutableTableCatalog = {
      columns: [],
      id,
      name,
      primaryKey: [],
      relationMap: new Map(),
      schema,
    };

    tables.set(id, nextTable);

    return nextTable;
  };

  const upsertRelation = (
    table: MutableTableCatalog,
    key: string,
    relation: MutableRelation
  ) => {
    table.relationMap.set(key, relation);
  };

  return {
    addColumnRows(columnRows: readonly ColumnRow[]) {
      for (const row of columnRows) {
        const table = ensureTable(row.schema_name, row.table_name);

        table.columns.push({
          dataType: row.data_type,
          isNullable: row.is_nullable,
          isPrimaryKey: false,
          name: row.column_name,
        });
      }
    },
    addForeignKeyRows(foreignKeyRows: readonly ForeignKeyRow[]) {
      for (const row of foreignKeyRows) {
        const sourceTable = ensureTable(row.source_schema, row.source_table);
        const targetTable = ensureTable(row.target_schema, row.target_table);

        upsertRelation(
          sourceTable,
          relationKey(row.constraint_name, row.target_table),
          {
            name: row.constraint_name,
            targetSchema: row.target_schema,
            targetTable: row.target_table,
          }
        );

        upsertRelation(targetTable, relationKey(row.source_table), {
          name: relationKey(row.source_table, row.constraint_name),
          targetSchema: row.source_schema,
          targetTable: row.source_table,
        });
      }
    },
    addManyToManyRows(foreignKeyRows: readonly ForeignKeyRow[]) {
      const foreignKeysBySourceTable = new Map<
        string,
        {
          foreignKeys: ForeignKeyRow[];
          schema: string;
          table: string;
        }
      >();

      for (const foreignKey of foreignKeyRows) {
        const key = tableKey(foreignKey.source_schema, foreignKey.source_table);
        const current = foreignKeysBySourceTable.get(key) ?? {
          foreignKeys: [],
          schema: foreignKey.source_schema,
          table: foreignKey.source_table,
        };

        current.foreignKeys.push(foreignKey);
        foreignKeysBySourceTable.set(key, current);
      }

      for (const candidate of foreignKeysBySourceTable.values()) {
        const bridgeTable = tables.get(
          tableKey(candidate.schema, candidate.table)
        );

        if (!bridgeTable || candidate.foreignKeys.length !== 2) {
          continue;
        }

        const combinedForeignColumns = Array.from(
          new Set(
            candidate.foreignKeys.flatMap((foreignKey) =>
              coerceStringArray(foreignKey.source_columns)
            )
          )
        );

        if (
          bridgeTable.primaryKey.length === 0 ||
          combinedForeignColumns.length !== bridgeTable.primaryKey.length ||
          !bridgeTable.primaryKey.every((column) =>
            combinedForeignColumns.includes(column)
          )
        ) {
          continue;
        }

        const [firstForeignKey, secondForeignKey] = candidate.foreignKeys;
        const firstTarget = tables.get(
          tableKey(firstForeignKey.target_schema, firstForeignKey.target_table)
        );
        const secondTarget = tables.get(
          tableKey(
            secondForeignKey.target_schema,
            secondForeignKey.target_table
          )
        );

        if (!(firstTarget && secondTarget)) {
          continue;
        }

        upsertRelation(
          firstTarget,
          relationKey(candidate.table, secondForeignKey.target_table),
          {
            name: relationKey(
              candidate.table,
              secondForeignKey.constraint_name
            ),
            targetSchema: secondForeignKey.target_schema,
            targetTable: secondForeignKey.target_table,
          }
        );

        upsertRelation(
          secondTarget,
          relationKey(candidate.table, firstForeignKey.target_table),
          {
            name: relationKey(candidate.table, firstForeignKey.constraint_name),
            targetSchema: firstForeignKey.target_schema,
            targetTable: firstForeignKey.target_table,
          }
        );
      }
    },
    addPrimaryKeyRows(primaryKeyRows: readonly PrimaryKeyRow[]) {
      for (const row of primaryKeyRows) {
        const table = ensureTable(row.schema_name, row.table_name);
        const primaryKey = coerceStringArray(row.columns);

        table.primaryKey = primaryKey;

        for (const columnName of primaryKey) {
          const column = table.columns.find(
            (candidate) => candidate.name === columnName
          );

          if (column) {
            column.isPrimaryKey = true;
          }
        }
      }
    },
    toResponse(database: string): AthenaTableCatalogResponse {
      return {
        database,
        generatedAt: new Date().toISOString(),
        tables: [...tables.values()]
          .map<AthenaTableCatalogTable>((table) => ({
            columns: [...table.columns].sort(
              (
                left: AthenaTableCatalogColumn,
                right: AthenaTableCatalogColumn
              ) => left.name.localeCompare(right.name)
            ),
            id: table.id,
            name: table.name,
            primaryKey: [...table.primaryKey],
            relations: [...table.relationMap.values()]
              .map<AthenaTableCatalogRelation>((relation) => ({
                columns:
                  tables.get(
                    tableKey(relation.targetSchema, relation.targetTable)
                  )?.columns ?? [],
                name: relation.name,
                targetSchema: relation.targetSchema,
                targetTable: relation.targetTable,
              }))
              .sort(
                (
                  left: AthenaTableCatalogRelation,
                  right: AthenaTableCatalogRelation
                ) => left.name.localeCompare(right.name)
              ),
            schema: table.schema,
          }))
          .sort(
            (left: AthenaTableCatalogTable, right: AthenaTableCatalogTable) =>
              left.id.localeCompare(right.id)
          ),
      };
    },
  };
}

async function queryRows<Row extends object>(
  client: AthenaTableCatalogQueryClient,
  query: string
) {
  const result = await client.query(query);

  if (result.error || result.status < 200 || result.status >= 300) {
    const errorMessage =
      typeof result.error === "string"
        ? result.error
        : result.error &&
            typeof result.error === "object" &&
            "message" in result.error &&
            typeof result.error.message === "string"
          ? result.error.message
          : `Athena gateway query failed with status ${result.status}.`;

    throw new Error(errorMessage);
  }

  return Array.isArray(result.data) ? (result.data as Row[]) : [];
}

/**
 * Whether `value` has the required string fields for schema catalog config.
 */
export function isAthenaTableSchemaConfig(
  value: unknown
): value is AthenaTableSchemaConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const config = value as Record<string, unknown>;

  return (
    typeof config.gatewayUrl === "string" &&
    typeof config.gatewayKey === "string" &&
    typeof config.gatewayDatabase === "string" &&
    typeof config.schemaScope === "string" &&
    typeof config.clientName === "string"
  );
}

/**
 * Whether gateway credentials are non-empty after trim.
 */
export function hasAthenaTableSchemaCredentials(
  config: AthenaTableSchemaConfig
): boolean {
  return (
    config.gatewayUrl.trim().length > 0 &&
    config.gatewayKey.trim().length > 0 &&
    config.gatewayDatabase.trim().length > 0
  );
}

/**
 * Introspect tables, columns, primary keys, and relations for the schemas in
 * `config.schemaScope` via the Athena gateway SQL API.
 */
export async function fetchAthenaTableCatalog(
  config: AthenaTableSchemaConfig,
  options: FetchAthenaTableCatalogOptions = {}
): Promise<AthenaTableCatalogResponse> {
  const schemas = parseAthenaTableSchemaScope(config.schemaScope);
  if (schemas.length === 0) {
    return {
      database: config.gatewayDatabase,
      generatedAt: new Date().toISOString(),
      tables: [],
    };
  }

  const queries = buildAthenaTableCatalogQueries(schemas);
  const client =
    options.client ??
    (createClient as (c: unknown) => NonNullable<typeof options.client>)({
      client: config.clientName.trim() || undefined,
      key: config.gatewayKey.trim(),
      url: config.gatewayUrl.trim(),
    });

  const [columnRows, primaryKeyRows, foreignKeyRows] = await Promise.all([
    queryRows<ColumnRow>(client, queries.columns),
    queryRows<PrimaryKeyRow>(client, queries.primaryKeys),
    queryRows<ForeignKeyRow>(client, queries.foreignKeys),
  ]);
  const catalog = createTableCatalog();

  catalog.addColumnRows(columnRows);
  catalog.addPrimaryKeyRows(primaryKeyRows);
  catalog.addForeignKeyRows(foreignKeyRows);
  catalog.addManyToManyRows(foreignKeyRows);

  return catalog.toResponse(config.gatewayDatabase);
}

/** @deprecated Prefer {@link fetchAthenaTableCatalog}. */
export const fetchTableCatalog = fetchAthenaTableCatalog;
