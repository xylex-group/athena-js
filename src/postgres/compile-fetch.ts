import {
  AthenaQueryError,
  type AthenaQueryPlan,
  type AthenaRelationCatalog,
  type AthenaSelectQueryAst,
  isAthenaQueryPlan,
  isAthenaSelectQueryAst,
  mergeRelationCatalogs,
  normalizeTransportPayload,
  resetQueryPlanAliases,
  resolveQueryPlan,
  selectPayloadHasRelations,
} from "../query/engine/index.ts";
import { compilePostgresAst, compilePostgresAstCount } from "./compile-ast.ts";
import type { AthenaPostgresQueryable } from "./driver.ts";
import { quotePostgresRegclassName } from "./identity.ts";
import { loadPostgresRelationCatalog } from "./relation-catalog.ts";
import type { PostgresCompiledQuery } from "./sql.ts";
import { PostgresSqlCompileError } from "./sql.ts";

const RESOLVE_BARE_RELATION_SQL = `
SELECT n.nspname AS schema_name
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.oid = to_regclass($1)
LIMIT 1
`.trim();

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
  const ast = await qualifyBareAstSource(
    normalizeTransportPayload(payload),
    queryable
  );
  const live = await loadPostgresRelationCatalog(queryable);
  const catalog = mergeRelationCatalogs(options?.catalog, live);
  return resolveQueryPlan(ast, { catalog });
}

/**
 * Bare names follow the connection `search_path` (`to_regclass`). Without that
 * schema, the same table name in another schema looks like a second foreign key.
 */
async function qualifyBareAstSource(
  ast: AthenaSelectQueryAst,
  queryable: AthenaPostgresQueryable
): Promise<AthenaSelectQueryAst> {
  if (ast.source.schema) {
    return ast;
  }
  let regclass: string;
  try {
    regclass = quotePostgresRegclassName(ast.source.table);
  } catch {
    return ast;
  }
  const resolved = await queryable.query<{ schema_name?: string }>(
    RESOLVE_BARE_RELATION_SQL,
    [regclass]
  );
  const schema = resolved.rows[0]?.schema_name;
  if (typeof schema !== "string" || schema.length === 0) {
    return ast;
  }
  return {
    ...ast,
    source: {
      ...ast.source,
      schema,
    },
  };
}

function rethrowStructuredCompile(error: unknown): never {
  if (
    error instanceof PostgresSqlCompileError ||
    error instanceof AthenaQueryError
  ) {
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
