import {
  AthenaQueryError,
  type AthenaQueryPlan,
  type AthenaRelationCatalog,
  isAthenaQueryPlan,
  isAthenaSelectQueryAst,
  mergeRelationCatalogs,
  normalizeTransportPayload,
  resolveQueryPlan,
  resetQueryPlanAliases,
  selectPayloadHasRelations,
} from "../query/engine/index.ts";
import { compilePostgresAst, compilePostgresAstCount } from "./compile-ast.ts";
import type { AthenaPostgresQueryable } from "./driver.ts";
import { loadPostgresRelationCatalog } from "./relation-catalog.ts";
import type { PostgresCompiledQuery } from "./sql.ts";
import { PostgresSqlCompileError } from "./sql.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function needsPostgresAstPipeline(payload: unknown): boolean {
  if (isAthenaSelectQueryAst(payload) || isAthenaQueryPlan(payload)) {
    return true;
  }
  if (selectPayloadHasRelations(payload)) {
    return true;
  }
  return isRecord(payload) && payload.operation === "select";
}

async function resolveStructuredPlan(
  payload: unknown,
  queryable: AthenaPostgresQueryable,
  options?: { catalog?: AthenaRelationCatalog }
): Promise<AthenaQueryPlan> {
  resetQueryPlanAliases();
  if (isAthenaQueryPlan(payload)) {
    return payload;
  }
  const ast = normalizeTransportPayload(payload);
  const live = await loadPostgresRelationCatalog(queryable);
  const catalog = mergeRelationCatalogs(options?.catalog, live);
  return resolveQueryPlan(ast, { catalog });
}

function rethrowStructuredCompile(error: unknown): never {
  if (error instanceof PostgresSqlCompileError || error instanceof AthenaQueryError) {
    throw error instanceof PostgresSqlCompileError
      ? error
      : new PostgresSqlCompileError(error.code, error.message);
  }
  throw error;
}

export async function compilePostgresStructuredFetch(
  payload: unknown,
  queryable: AthenaPostgresQueryable,
  options?: { catalog?: AthenaRelationCatalog }
): Promise<PostgresCompiledQuery> {
  try {
    return compilePostgresAst(
      await resolveStructuredPlan(payload, queryable, options)
    );
  } catch (error) {
    rethrowStructuredCompile(error);
  }
}

export async function compilePostgresStructuredCount(
  payload: unknown,
  queryable: AthenaPostgresQueryable,
  options?: { catalog?: AthenaRelationCatalog }
): Promise<PostgresCompiledQuery> {
  try {
    return compilePostgresAstCount(
      await resolveStructuredPlan(payload, queryable, options)
    );
  } catch (error) {
    rethrowStructuredCompile(error);
  }
}
