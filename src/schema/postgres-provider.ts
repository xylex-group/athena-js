import { Pool } from 'pg'
import type {
  IntrospectionColumn,
  IntrospectionInspectOptions,
  IntrospectionRelation,
  IntrospectionSchema,
  IntrospectionSnapshot,
  IntrospectionTable,
  SchemaIntrospectionProvider,
} from './types.ts'

type ColumnQueryRow = {
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

type PrimaryKeyQueryRow = {
  schema_name: string
  table_name: string
  columns: string[]
}

type ForeignKeyQueryRow = {
  source_schema: string
  source_table: string
  constraint_name: string
  source_columns: string[]
  target_schema: string
  target_table: string
  target_columns: string[]
  source_is_unique: boolean
}

type EnumQueryRow = {
  type_oid: number
  enum_label: string
}

type BridgeCandidate = {
  schema: string
  table: string
  foreignKeys: ForeignKeyQueryRow[]
}

export interface PostgresIntrospectionProviderOptions {
  connectionString: string
  database?: string
}

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

function ensureTable(
  schemaMap: Record<string, IntrospectionSchema>,
  schemaName: string,
  tableName: string,
): IntrospectionTable {
  if (!schemaMap[schemaName]) {
    schemaMap[schemaName] = {
      name: schemaName,
      tables: {},
    }
  }

  const schema = schemaMap[schemaName]
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

function upsertRelation(
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

async function queryColumns(pool: Pool, schemas: string[]): Promise<ColumnQueryRow[]> {
  const sql = `
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
  `

  const result = await pool.query<ColumnQueryRow>(sql, [schemas])
  return result.rows
}

async function queryEnums(pool: Pool): Promise<Map<number, string[]>> {
  const sql = `
    SELECT
      t.oid AS type_oid,
      e.enumlabel AS enum_label
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    ORDER BY t.oid, e.enumsortorder;
  `

  const result = await pool.query<EnumQueryRow>(sql)
  const enumMap = new Map<number, string[]>()
  for (const row of result.rows) {
    const existing = enumMap.get(row.type_oid) ?? []
    existing.push(row.enum_label)
    enumMap.set(row.type_oid, existing)
  }
  return enumMap
}

async function queryPrimaryKeys(pool: Pool, schemas: string[]): Promise<PrimaryKeyQueryRow[]> {
  const sql = `
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
  `

  const result = await pool.query<PrimaryKeyQueryRow>(sql, [schemas])
  return result.rows
}

async function queryForeignKeys(pool: Pool, schemas: string[]): Promise<ForeignKeyQueryRow[]> {
  const sql = `
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
  `

  const result = await pool.query<ForeignKeyQueryRow>(sql, [schemas])
  return result.rows
}

function addManyToManyRelations(
  schemaMap: Record<string, IntrospectionSchema>,
  foreignKeys: ForeignKeyQueryRow[],
) {
  const bySourceTable = new Map<string, BridgeCandidate>()
  for (const fk of foreignKeys) {
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
    const bridgeTable = schemaMap[candidate.schema]?.tables[candidate.table]
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
    const firstTarget = schemaMap[first.target_schema]?.tables[first.target_table]
    const secondTarget = schemaMap[second.target_schema]?.tables[second.target_table]
    if (!firstTarget || !secondTarget) {
      continue
    }

    upsertRelation(firstTarget, relationKey(second.target_table), {
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

    upsertRelation(secondTarget, relationKey(first.target_table), {
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

class PostgresIntrospectionProvider implements SchemaIntrospectionProvider {
  readonly backend = 'postgresql' as const

  private readonly connectionString: string
  private readonly database: string

  constructor(options: PostgresIntrospectionProviderOptions) {
    this.connectionString = options.connectionString
    this.database = options.database ?? 'postgres'
  }

  async inspect(options?: IntrospectionInspectOptions): Promise<IntrospectionSnapshot> {
    const schemas = options?.schemas && options.schemas.length > 0 ? options.schemas : ['public']
    const pool = new Pool({
      connectionString: this.connectionString,
    })

    try {
      const [columnRows, enumMap, primaryKeyRows, foreignKeyRows] = await Promise.all([
        queryColumns(pool, schemas),
        queryEnums(pool),
        queryPrimaryKeys(pool, schemas),
        queryForeignKeys(pool, schemas),
      ])

      const schemaMap: Record<string, IntrospectionSchema> = {}

      for (const columnRow of columnRows) {
        const table = ensureTable(schemaMap, columnRow.schema_name, columnRow.table_name)
        table.columns[columnRow.column_name] = {
          name: columnRow.column_name,
          dataType: columnRow.data_type,
          udtName: columnRow.udt_name,
          typeKind: toTypeKind(columnRow.type_kind_code),
          isNullable: columnRow.is_nullable,
          isPrimaryKey: false,
          hasDefault: columnRow.has_default,
          isGenerated: columnRow.is_generated,
          arrayDimensions: columnRow.array_dimensions ?? 0,
          enumValues: enumMap.get(columnRow.type_oid),
        }
      }

      for (const primaryKeyRow of primaryKeyRows) {
        const table = ensureTable(schemaMap, primaryKeyRow.schema_name, primaryKeyRow.table_name)
        table.primaryKey = primaryKeyRow.columns
        for (const columnName of primaryKeyRow.columns) {
          const column = table.columns[columnName]
          if (column) {
            column.isPrimaryKey = true
          }
        }
      }

      for (const foreignKeyRow of foreignKeyRows) {
        const sourceTable = ensureTable(schemaMap, foreignKeyRow.source_schema, foreignKeyRow.source_table)
        const targetTable = ensureTable(schemaMap, foreignKeyRow.target_schema, foreignKeyRow.target_table)

        const sourceRelationKind = foreignKeyRow.source_is_unique ? 'one-to-one' : 'many-to-one'
        upsertRelation(sourceTable, relationKey(foreignKeyRow.constraint_name, foreignKeyRow.target_table), {
          name: foreignKeyRow.constraint_name,
          kind: sourceRelationKind,
          sourceColumns: foreignKeyRow.source_columns,
          targetSchema: foreignKeyRow.target_schema,
          targetModel: foreignKeyRow.target_table,
          targetColumns: foreignKeyRow.target_columns,
        })

        const targetRelationKind = foreignKeyRow.source_is_unique ? 'one-to-one' : 'one-to-many'
        upsertRelation(targetTable, relationKey(foreignKeyRow.source_table), {
          name: relationKey(foreignKeyRow.source_table, foreignKeyRow.constraint_name),
          kind: targetRelationKind,
          sourceColumns: foreignKeyRow.target_columns,
          targetSchema: foreignKeyRow.source_schema,
          targetModel: foreignKeyRow.source_table,
          targetColumns: foreignKeyRow.source_columns,
        })
      }

      addManyToManyRelations(schemaMap, foreignKeyRows)

      return {
        backend: 'postgresql',
        database: this.database,
        generatedAt: new Date().toISOString(),
        schemas: schemaMap,
      }
    } finally {
      await pool.end()
    }
  }
}

export function createPostgresIntrospectionProvider(
  options: PostgresIntrospectionProviderOptions,
): SchemaIntrospectionProvider {
  return new PostgresIntrospectionProvider(options)
}
