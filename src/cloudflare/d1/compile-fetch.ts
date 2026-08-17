import {
  AthenaQueryError,
  type AthenaRelationCatalog,
  collectAstTables,
  isAthenaQueryPlan,
  isAthenaSelectQueryAst,
  mergeRelationCatalogs,
  normalizeTransportPayload,
  resolveQueryPlan,
  resetQueryPlanAliases,
  selectPayloadHasRelations,
} from "../../query/engine/index.ts";
import type { D1DatabaseLike } from "../types.ts";
import { compileD1Ast } from "./compile-ast.ts";
import { loadD1RelationCatalog } from "./relation-catalog.ts";
import { type D1CompiledSql, D1SqlCompileError } from "./sql.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function needsD1AstPipeline(payload: unknown): boolean {
  if (isAthenaSelectQueryAst(payload) || isAthenaQueryPlan(payload)) {
    return true;
  }
  if (selectPayloadHasRelations(payload)) {
    return true;
  }
  return isRecord(payload) && payload.operation === "select";
}

export async function compileD1StructuredFetch(
  payload: unknown,
  d1: D1DatabaseLike,
  options?: { catalog?: AthenaRelationCatalog }
): Promise<D1CompiledSql> {
  try {
    resetQueryPlanAliases();
    if (isAthenaQueryPlan(payload)) {
      return compileD1Ast(payload);
    }
    const ast = normalizeTransportPayload(payload);
    const tables = collectAstTables(ast).map((source) => source.table);
    const live = await loadD1RelationCatalog(d1, tables);
    const catalog = mergeRelationCatalogs(options?.catalog, live);
    const plan = resolveQueryPlan(ast, { catalog });
    return compileD1Ast(plan);
  } catch (error) {
    if (error instanceof D1SqlCompileError) {
      throw error;
    }
    if (error instanceof AthenaQueryError) {
      throw new D1SqlCompileError(error.code, error.message);
    }
    throw error;
  }
}
