import type {
  IntrospectionColumn,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionTable,
  ModelRelationKind,
} from './types.ts'

export type ColumnQueryRow = {
  schema_name: string
  table_name: string
  column_name: string
  data_type: string
  udt_name: string
  type_kind_code: string
  type_oid: number
  is_nullable: boolean
  has_default: boolean
  is_generated: boolean
  array_dimensions: number
}

export type PrimaryKeyQueryRow = {
  schema_name: string
  table_name: string
  columns: string[]
}

export type ForeignKeyQueryRow = {
  source_schema: string
  source_table: string
  constraint_name: string
  source_columns: string[]
  target_schema: string
  target_table: string
  target_columns: string[]
  source_is_unique: boolean
}

export type EnumQueryRow = {
  type_oid: number
  enum_label: string
}

type BridgeCandidate = {
  schema: string
  table: string
  foreignKeys: ForeignKeyQueryRow[]
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
  foreignKeys: `
    SELECT
      sn.nspname AS source_schema,
      sc.relname AS source_table,
      con.conname AS constraint_name,
      ARRAY_AGG(sa.attname ORDER BY cols.ordinality) AS source_columns,
      tn.nspname AS target_schema,
      tc.relname AS target_table,
      ARRAY_AGG(ta.attname ORDER BY cols.ordinality) AS target_columns,
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
      con.conrelid
    ORDER BY sn.nspname, sc.relname, con.conname;
  `,
} as const

function tableKey(schema: string, table: string): string {
  return `${schema}.${table}`
}

function relationKey(...parts: string[]): string {
  const base = parts
    .join('_')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return base.length > 0 ? base : 'relation'
}

function toTypeKind(code: string): IntrospectionColumn['typeKind'] {
  switch (code) {
    case 'e':
      return 'enum'
    case 'd':
      return 'domain'
    case 'r':
      return 'range'
    case 'm':
      return 'multirange'
    case 'c':
      return 'composite'
    default:
      return 'scalar'
  }
}

function escapeSqlLiteral(value: string): string {
  return value.replace(/'/g, "''")
}

function parsePostgresArrayLiteral(text: string): string[] {
  const body = text.slice(1, -1).trim()
  if (!body) return []

  const values: string[] = []
  let current = ''
  let inQuotes = false
  let escaped = false

  for (const char of body) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === ',' && !inQuotes) {
      values.push(current)
      current = ''
      continue
    }
    current += char
  }

  values.push(current)
  return values.map(value => value.trim()).filter(value => value.length > 0)
}

function coerceStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map(item => (typeof item === 'string' ? item : String(item)))
      .map(item => item.trim())
      .filter(item => item.length > 0)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return coerceStringArray(parsed)
      } catch {
        // Fall through to more permissive parsing paths.
      }
    }

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return parsePostgresArrayLiteral(trimmed)
    }

    return trimmed
      .split(',')
      .map(item => item.trim())
      .filter(item => item.length > 0)
  }

  return []
}

export function normalizePostgresCatalogSchemas(schemas?: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of schemas ?? []) {
    const schema = value.trim()
    if (!schema || seen.has(schema)) {
      continue
    }
    seen.add(schema)
    normalized.push(schema)
  }

  return normalized.length > 0 ? normalized : ['public']
}

export function buildSchemaArrayLiteral(schemas: readonly string[]): string {
  const normalized = normalizePostgresCatalogSchemas(schemas)
  const literals = normalized.map(schema => `'${escapeSqlLiteral(schema)}'`).join(', ')
  return `ARRAY[${literals}]`
}

function inlineSchemaLiteral(sql: string, schemas: readonly string[]): string {
  const schemaArray = `${buildSchemaArrayLiteral(schemas)}::text[]`
  return sql.replace(/\$1::text\[\]/g, schemaArray)
}

export function buildGatewayCatalogQueries(schemas: readonly string[]): {
  columns: string
  enums: string
  primaryKeys: string
  foreignKeys: string
} {
  return {
    columns: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.columns, schemas),
    enums: POSTGRES_CATALOG_SQL.enums,
    primaryKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.primaryKeys, schemas),
    foreignKeys: inlineSchemaLiteral(POSTGRES_CATALOG_SQL.foreignKeys, schemas),
  }
}

export class PostgresCatalogSnapshotAssembler {
  private readonly schemas: Record<string, IntrospectionSchema> = {}

  addColumnRows(columnRows: ColumnQueryRow[], enumMap: Map<number, string[]>) {
    for (const row of columnRows) {
      const table = this.ensureTable(row.schema_name, row.table_name)
      table.columns[row.column_name] = {
        name: row.column_name,
        dataType: row.data_type,
        udtName: row.udt_name,
        typeKind: toTypeKind(row.type_kind_code),
        isNullable: row.is_nullable,
        isPrimaryKey: false,
        hasDefault: row.has_default,
        isGenerated: row.is_generated,
        arrayDimensions: row.array_dimensions ?? 0,
        enumValues: enumMap.get(row.type_oid),
      }
    }
  }

  addPrimaryKeyRows(primaryKeyRows: PrimaryKeyQueryRow[]) {
    for (const row of primaryKeyRows) {
      const table = this.ensureTable(row.schema_name, row.table_name)
      const primaryKeyColumns = coerceStringArray(row.columns)
      row.columns = primaryKeyColumns
      table.primaryKey = primaryKeyColumns
      for (const columnName of primaryKeyColumns) {
        const column = table.columns[columnName]
        if (column) {
          column.isPrimaryKey = true
        }
      }
    }
  }

  addForeignKeyRows(foreignKeyRows: ForeignKeyQueryRow[]) {
    for (const row of foreignKeyRows) {
      const sourceTable = this.ensureTable(row.source_schema, row.source_table)
      const targetTable = this.ensureTable(row.target_schema, row.target_table)
      const sourceColumns = coerceStringArray(row.source_columns)
      const targetColumns = coerceStringArray(row.target_columns)
      row.source_columns = sourceColumns
      row.target_columns = targetColumns

      const sourceRelationKind: ModelRelationKind = row.source_is_unique ? 'one-to-one' : 'many-to-one'
      this.upsertRelation(sourceTable, relationKey(row.constraint_name, row.target_table), {
        name: row.constraint_name,
        kind: sourceRelationKind,
        sourceColumns,
        targetSchema: row.target_schema,
        targetModel: row.target_table,
        targetColumns,
      })

      const targetRelationKind: ModelRelationKind = row.source_is_unique ? 'one-to-one' : 'one-to-many'
      this.upsertRelation(targetTable, relationKey(row.source_table), {
        name: relationKey(row.source_table, row.constraint_name),
        kind: targetRelationKind,
        sourceColumns: targetColumns,
        targetSchema: row.source_schema,
        targetModel: row.source_table,
        targetColumns: sourceColumns,
      })
    }
  }

  addManyToManyRows(foreignKeyRows: ForeignKeyQueryRow[]) {
    const bySourceTable = new Map<string, BridgeCandidate>()
    for (const fk of foreignKeyRows) {
      const key = tableKey(fk.source_schema, fk.source_table)
      const current = bySourceTable.get(key) ?? {
        schema: fk.source_schema,
        table: fk.source_table,
        foreignKeys: [],
      }
      current.foreignKeys.push(fk)
      bySourceTable.set(key, current)
    }

    for (const candidate of bySourceTable.values()) {
      const bridgeTable = this.schemas[candidate.schema]?.tables[candidate.table]
      if (!bridgeTable) continue

      const primaryKey = bridgeTable.primaryKey
      if (candidate.foreignKeys.length !== 2 || primaryKey.length === 0) continue

      const combinedForeignColumns = Array.from(
        new Set(candidate.foreignKeys.flatMap(fk => fk.source_columns)),
      )
      if (
        combinedForeignColumns.length !== primaryKey.length ||
        !primaryKey.every(column => combinedForeignColumns.includes(column))
      ) {
        continue
      }

      const [first, second] = candidate.foreignKeys
      const firstTarget = this.schemas[first.target_schema]?.tables[first.target_table]
      const secondTarget = this.schemas[second.target_schema]?.tables[second.target_table]
      if (!firstTarget || !secondTarget) {
        continue
      }

      this.upsertRelation(firstTarget, relationKey(second.target_table), {
        name: relationKey(candidate.table, first.constraint_name, second.constraint_name),
        kind: 'many-to-many',
        sourceColumns: first.target_columns,
        targetSchema: second.target_schema,
        targetModel: second.target_table,
        targetColumns: second.target_columns,
        through: {
          schema: candidate.schema,
          model: candidate.table,
          sourceColumns: first.source_columns,
          targetColumns: second.source_columns,
        },
      })

      this.upsertRelation(secondTarget, relationKey(first.target_table), {
        name: relationKey(candidate.table, second.constraint_name, first.constraint_name),
        kind: 'many-to-many',
        sourceColumns: second.target_columns,
        targetSchema: first.target_schema,
        targetModel: first.target_table,
        targetColumns: first.target_columns,
        through: {
          schema: candidate.schema,
          model: candidate.table,
          sourceColumns: second.source_columns,
          targetColumns: first.source_columns,
        },
      })
    }
  }

  toSchemas(): Record<string, IntrospectionSchema> {
    return this.schemas
  }

  private ensureTable(schemaName: string, tableName: string): IntrospectionTable {
    if (!this.schemas[schemaName]) {
      this.schemas[schemaName] = {
        name: schemaName,
        tables: {},
      }
    }

    const schema = this.schemas[schemaName]
    if (!schema.tables[tableName]) {
      schema.tables[tableName] = {
        schema: schemaName,
        name: tableName,
        columns: {},
        primaryKey: [],
        relations: {},
      }
    }

    return schema.tables[tableName]
  }

  private upsertRelation(
    table: IntrospectionTable,
    baseKey: string,
    relation: IntrospectionRelation,
  ) {
    let key = baseKey
    let suffix = 2
    while (table.relations[key]) {
      key = `${baseKey}_${suffix}`
      suffix += 1
    }
    table.relations[key] = relation
  }
}
