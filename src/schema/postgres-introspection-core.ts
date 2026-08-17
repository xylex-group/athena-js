import type {
  IntrospectionColumn,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionTable,
  ModelRelationKind,
} from "./types.ts";

export interface ColumnQueryRow {
  array_dimensions: number;
  column_name: string;
  data_type: string;
  /** Present when catalog SQL includes `pg_get_expr`; optional for older mocks. */
  default_expression?: string | null;
  has_default: boolean;
  is_generated: boolean;
  is_nullable: boolean;
  schema_name: string;
  table_name: string;
  type_kind_code: string;
  type_oid: number;
  udt_name: string;
}

export interface PrimaryKeyQueryRow {
  columns: string[];
  schema_name: string;
  table_name: string;
}

export interface ForeignKeyQueryRow {
  constraint_name: string;
  /** Postgres confdeltype: a/r/c/n/d */
  on_delete?: string | null;
  /** Postgres confupdtype: a/r/c/n/d */
  on_update?: string | null;
  source_columns: string[];
  source_is_unique: boolean;
  source_schema: string;
  source_table: string;
  target_columns: string[];
  target_schema: string;
  target_table: string;
}

export interface EnumQueryRow {
  enum_label: string;
  type_oid: number;
}

export interface UniqueConstraintQueryRow {
  columns: string[];
  constraint_name: string;
  schema_name: string;
  table_name: string;
}

export interface IndexQueryRow {
  /** Parallel to `columns`: `"asc"` | `"desc"` (from pg_index.indoption). */
  column_directions?: string[] | null;
  columns: string[];
  index_name: string;
  is_unique: boolean;
  method: string | null;
  predicate: string | null;
  schema_name: string;
  table_name: string;
}

interface BridgeCandidate {
  foreignKeys: ForeignKeyQueryRow[];
  schema: string;
  table: string;
}

export const POSTGRES_CATALOG_SQL = {
  columns: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      a.attname AS column_name,
      format_type(a.atttypid, a.atttypmod) AS data_type,
      t.typname AS udt_name,
      t.typtype AS type_kind_code,
      t.oid AS type_oid,
      NOT a.attnotnull AS is_nullable,
      (ad.adbin IS NOT NULL) AS has_default,
      pg_get_expr(ad.adbin, ad.adrelid) AS default_expression,
      (a.attgenerated <> '') AS is_generated,
      a.attndims AS array_dimensions
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
    WHERE c.relkind IN ('r', 'p')
      AND a.attnum > 0
      AND NOT a.attisdropped
      AND n.nspname = ANY($1::text[])
    ORDER BY n.nspname, c.relname, a.attnum;
  `,
  enums: `
    SELECT
      t.oid AS type_oid,
      e.enumlabel AS enum_label
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    ORDER BY t.oid, e.enumsortorder;
  `,
  foreignKeys: `
    SELECT
      sn.nspname AS source_schema,
      sc.relname AS source_table,
      con.conname AS constraint_name,
      ARRAY_AGG(sa.attname ORDER BY cols.ordinality) AS source_columns,
      tn.nspname AS target_schema,
      tc.relname AS target_table,
      ARRAY_AGG(ta.attname ORDER BY cols.ordinality) AS target_columns,
      con.confdeltype::text AS on_delete,
      con.confupdtype::text AS on_update,
      EXISTS (
        SELECT 1
        FROM pg_constraint uq
        WHERE uq.conrelid = con.conrelid
          AND uq.contype IN ('p', 'u')
          AND uq.conkey = con.conkey
      ) AS source_is_unique
    FROM pg_constraint con
    JOIN pg_class sc ON sc.oid = con.conrelid
    JOIN pg_namespace sn ON sn.oid = sc.relnamespace
    JOIN pg_class tc ON tc.oid = con.confrelid
    JOIN pg_namespace tn ON tn.oid = tc.relnamespace
    JOIN unnest(con.conkey, con.confkey) WITH ORDINALITY AS cols(source_attnum, target_attnum, ordinality) ON TRUE
    JOIN pg_attribute sa ON sa.attrelid = con.conrelid AND sa.attnum = cols.source_attnum
    JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = cols.target_attnum
    WHERE con.contype = 'f'
      AND sn.nspname = ANY($1::text[])
      AND tn.nspname = ANY($1::text[])
    GROUP BY
      sn.nspname,
      sc.relname,
      con.conname,
      tn.nspname,
      tc.relname,
      con.conkey,
      con.conrelid,
      con.confdeltype,
      con.confupdtype
    ORDER BY sn.nspname, sc.relname, con.conname;
  `,
  uniqueConstraints: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      ARRAY_AGG(a.attname ORDER BY ck.ordinality) AS columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ck.attnum
    WHERE con.contype = 'u'
      AND n.nspname = ANY($1::text[])
    GROUP BY n.nspname, c.relname, con.conname
    ORDER BY n.nspname, c.relname, con.conname;
  `,
  indexes: `
    SELECT
      n.nspname AS schema_name,
      t.relname AS table_name,
      i.relname AS index_name,
      ix.indisunique AS is_unique,
      am.amname AS method,
      pg_get_expr(ix.indpred, ix.indrelid) AS predicate,
      ARRAY_AGG(a.attname ORDER BY cols.ordinality) AS columns,
      ARRAY_AGG(
        CASE
          WHEN ((ix.indoption::int2[])[cols.ordinality] & 1) = 1 THEN 'desc'
          ELSE 'asc'
        END
        ORDER BY cols.ordinality
      ) AS column_directions
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    JOIN pg_class t ON t.oid = ix.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    JOIN pg_am am ON am.oid = i.relam
    JOIN unnest(ix.indkey) WITH ORDINALITY AS cols(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = cols.attnum
    WHERE n.nspname = ANY($1::text[])
      AND t.relkind IN ('r', 'p')
      AND NOT ix.indisprimary
      AND cols.attnum > 0
    GROUP BY
      n.nspname,
      t.relname,
      i.relname,
      ix.indisunique,
      am.amname,
      ix.indpred,
      ix.indrelid,
      ix.indoption
    ORDER BY n.nspname, t.relname, i.relname;
  `,
  primaryKeys: `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      ARRAY_AGG(a.attname ORDER BY ck.ordinality) AS columns
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN unnest(con.conkey) WITH ORDINALITY AS ck(attnum, ordinality) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ck.attnum
    WHERE con.contype = 'p'
      AND n.nspname = ANY($1::text[])
    GROUP BY n.nspname, c.relname
    ORDER BY n.nspname, c.relname;
  `,
} as const;

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function relationKey(...parts: string[]): string {
  const base = parts
    .join("_")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base.length > 0 ? base : "relation";
}

function toTypeKind(code: string): IntrospectionColumn["typeKind"] {
  switch (code) {
    case "e":
      return "enum";
    case "d":
      return "domain";
    case "r":
      return "range";
    case "m":
      return "multirange";
    case "c":
      return "composite";
    default:
      return "scalar";
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

function parsePostgresArrayLiteral(text: string): string[] {
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

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : String(item)))
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        return coerceStringArray(parsed);
      } catch {
        // Fall through to more permissive parsing paths.
      }
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      return parsePostgresArrayLiteral(trimmed);
    }

    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  return [];
}

export function normalizePostgresCatalogSchemas(
  schemas?: readonly string[]
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of schemas ?? []) {
    const schema = value.trim();
    if (!schema || seen.has(schema)) {
      continue;
    }
    seen.add(schema);
    normalized.push(schema);
  }

  return normalized.length > 0 ? normalized : ["public"];
}

export function buildSchemaArrayLiteral(schemas: readonly string[]): string {
  const normalized = normalizePostgresCatalogSchemas(schemas);
  const literals = normalized
    .map((schema) => `'${escapeSqlLiteral(schema)}'`)
    .join(", ");
  return `ARRAY[${literals}]`;
}

function inlineSchemaLiteral(sql: string, schemas: readonly string[]): string {
  const schemaArray = `${buildSchemaArrayLiteral(schemas)}::text[]`;
  return sql.replace(/\$1::text\[\]/g, schemaArray);
}

export function buildGatewayCatalogQueries(schemas: readonly string[]): {
  columns: string;
  enums: string;
  primaryKeys: string;
  foreignKeys: string;
  uniqueConstraints: string;
  indexes: string;
} {
  return {
    columns: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.columns, schemas),
    enums: POSTGRES_CATALOG_SQL.enums,
    foreignKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.foreignKeys, schemas),
    indexes: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.indexes, schemas),
    primaryKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.primaryKeys, schemas),
    uniqueConstraints: inlineSchemaLiteral(
      POSTGRES_CATALOG_SQL.uniqueConstraints,
      schemas
    ),
  };
}

export class PostgresCatalogSnapshotAssembler {
  private readonly schemas: Record<string, IntrospectionSchema> = {};

  addColumnRows(columnRows: ColumnQueryRow[], enumMap: Map<number, string[]>) {
    for (const row of columnRows) {
      const table = this.ensureTable(row.schema_name, row.table_name);
      table.columns[row.column_name] = {
        arrayDimensions: row.array_dimensions ?? 0,
        dataType: row.data_type,
        defaultExpression: row.default_expression ?? null,
        enumValues: enumMap.get(row.type_oid),
        hasDefault: row.has_default,
        isGenerated: row.is_generated,
        isNullable: row.is_nullable,
        isPrimaryKey: false,
        name: row.column_name,
        typeKind: toTypeKind(row.type_kind_code),
        udtName: row.udt_name,
      };
    }
  }

  addPrimaryKeyRows(primaryKeyRows: PrimaryKeyQueryRow[]) {
    for (const row of primaryKeyRows) {
      const table = this.ensureTable(row.schema_name, row.table_name);
      const primaryKeyColumns = coerceStringArray(row.columns);
      row.columns = primaryKeyColumns;
      table.primaryKey = primaryKeyColumns;
      for (const columnName of primaryKeyColumns) {
        const column = table.columns[columnName];
        if (column) {
          column.isPrimaryKey = true;
        }
      }
    }
  }

  addForeignKeyRows(foreignKeyRows: ForeignKeyQueryRow[]) {
    for (const row of foreignKeyRows) {
      const sourceTable = this.ensureTable(row.source_schema, row.source_table);
      const targetTable = this.ensureTable(row.target_schema, row.target_table);
      const sourceColumns = coerceStringArray(row.source_columns);
      const targetColumns = coerceStringArray(row.target_columns);
      row.source_columns = sourceColumns;
      row.target_columns = targetColumns;

      const sourceRelationKind: ModelRelationKind = row.source_is_unique
        ? "one-to-one"
        : "many-to-one";
      this.upsertRelation(
        sourceTable,
        relationKey(row.constraint_name, row.target_table),
        {
          kind: sourceRelationKind,
          name: row.constraint_name,
          onDelete: row.on_delete ?? null,
          onUpdate: row.on_update ?? null,
          sourceColumns,
          targetColumns,
          targetModel: row.target_table,
          targetSchema: row.target_schema,
        }
      );

      const targetRelationKind: ModelRelationKind = row.source_is_unique
        ? "one-to-one"
        : "one-to-many";
      this.upsertRelation(targetTable, relationKey(row.source_table), {
        kind: targetRelationKind,
        name: relationKey(row.source_table, row.constraint_name),
        sourceColumns: targetColumns,
        targetColumns: sourceColumns,
        targetModel: row.source_table,
        targetSchema: row.source_schema,
      });
    }
  }

  addUniqueConstraintRows(rows: UniqueConstraintQueryRow[]) {
    for (const row of rows) {
      const table = this.ensureTable(row.schema_name, row.table_name);
      const columns = coerceStringArray(row.columns);
      table.uniqueConstraints = table.uniqueConstraints ?? [];
      table.uniqueConstraints.push({
        columns,
        name: row.constraint_name,
      });
    }
  }

  addIndexRows(rows: IndexQueryRow[]) {
    for (const row of rows) {
      const table = this.ensureTable(row.schema_name, row.table_name);
      const columns = coerceStringArray(row.columns);
      const rawDirections = coerceStringArray(row.column_directions);
      const columnDirections = columns.map((_, i) =>
        rawDirections[i]?.toLowerCase() === "desc"
          ? ("desc" as const)
          : ("asc" as const)
      );
      // Skip unique indexes that already mirror a unique constraint of the same columns.
      const uniqueCols = new Set(
        (table.uniqueConstraints ?? []).map((u) => u.columns.join("\0"))
      );
      if (row.is_unique && uniqueCols.has(columns.join("\0"))) {
        continue;
      }
      table.indexes = table.indexes ?? [];
      table.indexes.push({
        columnDirections,
        columns,
        method: row.method ?? null,
        name: row.index_name,
        predicate: row.predicate ?? null,
        unique: Boolean(row.is_unique),
      });
    }
  }

  addManyToManyRows(foreignKeyRows: ForeignKeyQueryRow[]) {
    const bySourceTable = new Map<string, BridgeCandidate>();
    for (const fk of foreignKeyRows) {
      const key = tableKey(fk.source_schema, fk.source_table);
      const current = bySourceTable.get(key) ?? {
        foreignKeys: [],
        schema: fk.source_schema,
        table: fk.source_table,
      };
      current.foreignKeys.push(fk);
      bySourceTable.set(key, current);
    }

    for (const candidate of bySourceTable.values()) {
      const bridgeTable =
        this.schemas[candidate.schema]?.tables[candidate.table];
      if (!bridgeTable) {
        continue;
      }

      const primaryKey = bridgeTable.primaryKey;
      if (candidate.foreignKeys.length !== 2 || primaryKey.length === 0) {
        continue;
      }

      const combinedForeignColumns = Array.from(
        new Set(candidate.foreignKeys.flatMap((fk) => fk.source_columns))
      );
      if (
        combinedForeignColumns.length !== primaryKey.length ||
        !primaryKey.every((column) => combinedForeignColumns.includes(column))
      ) {
        continue;
      }

      const [first, second] = candidate.foreignKeys;
      const firstTarget =
        this.schemas[first.target_schema]?.tables[first.target_table];
      const secondTarget =
        this.schemas[second.target_schema]?.tables[second.target_table];
      if (!(firstTarget && secondTarget)) {
        continue;
      }

      this.upsertRelation(firstTarget, relationKey(second.target_table), {
        kind: "many-to-many",
        name: relationKey(
          candidate.table,
          first.constraint_name,
          second.constraint_name
        ),
        sourceColumns: first.target_columns,
        targetColumns: second.target_columns,
        targetModel: second.target_table,
        targetSchema: second.target_schema,
        through: {
          model: candidate.table,
          schema: candidate.schema,
          sourceColumns: first.source_columns,
          targetColumns: second.source_columns,
        },
      });

      this.upsertRelation(secondTarget, relationKey(first.target_table), {
        kind: "many-to-many",
        name: relationKey(
          candidate.table,
          second.constraint_name,
          first.constraint_name
        ),
        sourceColumns: second.target_columns,
        targetColumns: first.target_columns,
        targetModel: first.target_table,
        targetSchema: first.target_schema,
        through: {
          model: candidate.table,
          schema: candidate.schema,
          sourceColumns: second.source_columns,
          targetColumns: first.source_columns,
        },
      });
    }
  }

  toSchemas(): Record<string, IntrospectionSchema> {
    return this.schemas;
  }

  private ensureTable(
    schemaName: string,
    tableName: string
  ): IntrospectionTable {
    if (!this.schemas[schemaName]) {
      this.schemas[schemaName] = {
        name: schemaName,
        tables: {},
      };
    }

    const schema = this.schemas[schemaName];
    if (!schema.tables[tableName]) {
      schema.tables[tableName] = {
        columns: {},
        indexes: [],
        name: tableName,
        primaryKey: [],
        relations: {},
        schema: schemaName,
        uniqueConstraints: [],
      };
    }

    return schema.tables[tableName];
  }

  private upsertRelation(
    table: IntrospectionTable,
    baseKey: string,
    relation: IntrospectionRelation
  ) {
    let key = baseKey;
    let suffix = 2;
    while (table.relations[key]) {
      key = `${baseKey}_${suffix}`;
      suffix += 1;
    }
    table.relations[key] = relation;
  }
}
