import type {
  AthenaRelationCatalog,
  AthenaRelationDescriptor,
} from "../query/engine/index.ts";
import { canonicalIdentity } from "../query/engine/index.ts";
import type { AthenaPostgresQueryable } from "./driver.ts";

const FK_SQL = `
SELECT
  src_ns.nspname AS from_schema,
  src_rel.relname AS from_table,
  src_att.attname AS from_column,
  dst_ns.nspname AS to_schema,
  dst_rel.relname AS to_table,
  dst_att.attname AS to_column,
  con.conname AS constraint_name,
  src_ord.ordinality AS position
FROM pg_constraint con
JOIN pg_class src_rel ON src_rel.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src_rel.relnamespace
JOIN pg_class dst_rel ON dst_rel.oid = con.confrelid
JOIN pg_namespace dst_ns ON dst_ns.oid = dst_rel.relnamespace
JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS src_ord(attnum, ordinality) ON true
JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS dst_ord(attnum, ordinality)
  ON dst_ord.ordinality = src_ord.ordinality
JOIN pg_attribute src_att
  ON src_att.attrelid = src_rel.oid AND src_att.attnum = src_ord.attnum
JOIN pg_attribute dst_att
  ON dst_att.attrelid = dst_rel.oid AND dst_att.attnum = dst_ord.attnum
WHERE con.contype = 'f'
  AND NOT src_att.attisdropped
  AND NOT dst_att.attisdropped
ORDER BY src_ns.nspname, src_rel.relname, con.conname, src_ord.ordinality
`.trim();

const UNIQUE_SQL = `
SELECT
  n.nspname AS table_schema,
  c.relname AS table_name,
  a.attname AS column_name,
  con.conname AS constraint_name
FROM pg_constraint con
JOIN pg_class c ON c.oid = con.conrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN LATERAL unnest(con.conkey) AS cols(attnum) ON true
JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = cols.attnum
WHERE con.contype IN ('p', 'u')
  AND NOT a.attisdropped
ORDER BY n.nspname, c.relname, con.conname, a.attname
`.trim();

interface ForeignKeyRow {
  constraint_name: string;
  from_column: string;
  from_schema: string;
  from_table: string;
  position: number | string;
  to_column: string;
  to_schema: string;
  to_table: string;
}

interface UniqueKeyRow {
  column_name: string;
  constraint_name: string;
  table_name: string;
  table_schema: string;
}

const catalogCache = new WeakMap<
  AthenaPostgresQueryable,
  Promise<AthenaRelationCatalog>
>();

function sortedJoin(columns: string[]): string {
  return [...columns].sort().join("\0");
}

export function childForeignKeyMatchesUniqueSet(
  fkColumns: readonly string[],
  uniqueColumns: readonly string[]
): boolean {
  if (fkColumns.length === 0) {
    return false;
  }
  if (new Set(fkColumns).size !== fkColumns.length) {
    return false;
  }
  return sortedJoin([...fkColumns]) === sortedJoin([...uniqueColumns]);
}

export async function loadPostgresRelationCatalog(
  queryable: AthenaPostgresQueryable
): Promise<AthenaRelationCatalog> {
  const cached = catalogCache.get(queryable);
  if (cached) {
    return cached;
  }
  const pending = Promise.all([
    queryable.query(FK_SQL),
    queryable.query(UNIQUE_SQL),
  ]).then(([fkResult, uniqueResult]) => {
    const uniqueSets = new Map<string, string[][]>();
    const uniqueGroups = new Map<string, string[]>();
    for (const raw of uniqueResult.rows as UniqueKeyRow[]) {
      const key = `${raw.table_schema}.${raw.table_name}\0${raw.constraint_name}`;
      const columns = uniqueGroups.get(key) ?? [];
      columns.push(raw.column_name);
      uniqueGroups.set(key, columns);
    }
    for (const [key, columns] of uniqueGroups) {
      const tableKey = key.split("\0")[0] ?? "";
      const sets = uniqueSets.get(tableKey) ?? [];
      sets.push(columns);
      uniqueSets.set(tableKey, sets);
    }

    const groups = new Map<string, AthenaRelationDescriptor>();
    for (const raw of fkResult.rows as ForeignKeyRow[]) {
      const id = canonicalIdentity(
        "relation",
        "postgres",
        raw.from_schema,
        raw.from_table,
        raw.constraint_name
      );
      const constraint = canonicalIdentity(
        "constraint",
        "postgres",
        raw.from_schema,
        raw.from_table,
        raw.constraint_name
      );
      const existing = groups.get(id);
      if (existing) {
        existing.from.columns.push(raw.from_column);
        existing.to.columns.push(raw.to_column);
        if (!existing.constraintAliases?.includes(raw.from_column)) {
          existing.constraintAliases?.push(raw.from_column);
        }
        continue;
      }
      groups.set(id, {
        cardinality: "many-to-one",
        constraint,
        constraintAliases: [raw.constraint_name, raw.from_column],
        from: {
          columns: [raw.from_column],
          schema: raw.from_schema,
          table: raw.from_table,
        },
        id,
        name: raw.to_table,
        source: "provider-discovery",
        to: {
          columns: [raw.to_column],
          schema: raw.to_schema,
          table: raw.to_table,
        },
      });
    }
    for (const entry of groups.values()) {
      const tableKey = `${entry.from.schema ?? ""}.${entry.from.table}`;
      const unique = uniqueSets.get(tableKey) ?? [];
      if (
        unique.some((columns) =>
          childForeignKeyMatchesUniqueSet(entry.from.columns, columns)
        )
      ) {
        entry.cardinality = "one-to-one";
      }
    }
    return { entries: [...groups.values()] };
  });
  catalogCache.set(queryable, pending);
  return pending;
}
