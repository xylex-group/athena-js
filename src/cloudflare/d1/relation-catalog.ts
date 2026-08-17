import type { AthenaRelationCatalog, AthenaRelationDescriptor } from "../../query/engine/index.ts";
import type { D1DatabaseLike } from "../types.ts";
import { executeD1Query } from "./runner.ts";

const SAFE_TABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ForeignKeyPragmaRow {
  from?: string;
  id?: number;
  seq?: number;
  table?: string;
  to?: string;
}

export async function loadD1RelationCatalog(
  d1: D1DatabaseLike,
  tables: string[]
): Promise<AthenaRelationCatalog> {
  const entries: AthenaRelationDescriptor[] = [];
  const seen = new Set<string>();

  for (const rawTable of tables) {
    const table = rawTable.includes(".")
      ? (rawTable.split(".").pop() ?? rawTable)
      : rawTable;
    if (!SAFE_TABLE.test(table)) {
      continue;
    }
    const result = await executeD1Query(d1, {
      query: `PRAGMA foreign_key_list(${table})`,
    });
    if (!result.ok) {
      continue;
    }
    const grouped = new Map<string, AthenaRelationDescriptor>();
    for (const raw of result.rows as ForeignKeyPragmaRow[]) {
      const constraintId = String(raw.id ?? 0);
      const id = `d1.${table}.${constraintId}`;
      const existing = grouped.get(id);
      const fromCol = String(raw.from ?? "");
      const toCol = String(raw.to ?? "");
      const toTable = String(raw.table ?? "");
      if (!(fromCol && toCol && toTable)) {
        continue;
      }
      if (existing) {
        existing.from.columns.push(fromCol);
        existing.to.columns.push(toCol);
        continue;
      }
      grouped.set(id, {
        cardinality: "many-to-one",
        from: { columns: [fromCol], table },
        id,
        name: toTable,
        to: { columns: [toCol], table: toTable },
      });
    }
    for (const entry of grouped.values()) {
      if (seen.has(entry.id)) {
        continue;
      }
      seen.add(entry.id);
      entries.push(entry);
    }
  }

  return { entries };
}
