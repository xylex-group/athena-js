import type { AthenaRelationCatalog, AthenaRelationDescriptor } from "../query/engine/index.ts";
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

const catalogCache = new WeakMap<AthenaPostgresQueryable, Promise<AthenaRelationCatalog>>();

export async function loadPostgresRelationCatalog(
  queryable: AthenaPostgresQueryable
): Promise<AthenaRelationCatalog> {
  const cached = catalogCache.get(queryable);
  if (cached) {
    return cached;
  }
  const pending = queryable.query(FK_SQL).then((result) => {
    const groups = new Map<string, AthenaRelationDescriptor>();
    for (const raw of result.rows as ForeignKeyRow[]) {
      const id = `${raw.from_schema}.${raw.from_table}.${raw.constraint_name}`;
      const existing = groups.get(id);
      if (existing) {
        existing.from.columns.push(raw.from_column);
        existing.to.columns.push(raw.to_column);
        continue;
      }
      groups.set(id, {
        cardinality: "many-to-one",
        from: {
          columns: [raw.from_column],
          schema: raw.from_schema,
          table: raw.from_table,
        },
        id,
        name: raw.to_table,
        to: {
          columns: [raw.to_column],
          schema: raw.to_schema,
          table: raw.to_table,
        },
      });
    }
    return { entries: [...groups.values()] };
  });
  catalogCache.set(queryable, pending);
  return pending;
}
