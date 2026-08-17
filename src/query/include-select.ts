import { compileSelectShape } from "../query-ast.ts";
import type { AthenaSelectShape } from "../query-ast.ts";
import type { AthenaRelationDescriptor } from "./descriptor.ts";

function relationEmbedToken(relation: AthenaRelationDescriptor): string {
  const table = relation.via?.trim() || relation.targetModel?.trim() || relation.name;
  const schema = relation.targetSchema?.trim();
  return schema ? `${schema}.${table}` : table;
}

function relationSelectShape(
  relation: AthenaRelationDescriptor
): AthenaSelectShape {
  if (relation.star || !relation.columns?.length) {
    return { "*": true };
  }
  return Object.fromEntries(relation.columns.map((column) => [column, true]));
}

/**
 * Merge root projection + consumed `.include()` relations into a gateway
 * nested-select string (`id,name,organization:public.orgs(id,name)`).
 */
export function compileIncludeSelectString(
  columns: string | string[],
  relations: readonly AthenaRelationDescriptor[] | undefined
): string {
  if (!relations?.length) {
    return Array.isArray(columns) ? columns.join(",") : columns;
  }

  const shape: AthenaSelectShape = {};
  const rawColumns = (Array.isArray(columns) ? columns : [columns])
    .map((column) => column.trim())
    .filter(Boolean);
  const isStar =
    rawColumns.length === 0 || rawColumns.some((column) => column === "*");

  if (isStar) {
    shape["*"] = true;
  } else {
    for (const column of rawColumns) {
      shape[column] = true;
    }
  }

  for (const relation of relations) {
    const embed = relationEmbedToken(relation);
    shape[relation.name] = {
      as: relation.name === embed ? undefined : relation.name,
      select: relationSelectShape(relation),
      via: embed,
    };
  }

  return compileSelectShape(shape);
}

export function selectStringHasRelationEmbed(select: string): boolean {
  return /[A-Za-z_][\w.]*\s*\([^)]*\)/.test(select);
}
