/**
 * Explicit administrative raw SQL surface for Athena-JS 3.7 (Dragunov-compatible).
 *
 * Prefer this over root `athena.query()` which remains a deprecated compatibility alias.
 */

import type { AthenaResult, AthenaResultFormatter } from "../client-result.ts";
import { resolveMutationAffectedRows } from "../result/mutation-meta.ts";
import type { AthenaGatewayClient } from "../gateway/client.ts";
import { ATHENA_GATEWAY_ROUTES } from "../gateway/routes.ts";
import type {
  AthenaGatewayCallOptions,
  AthenaQueryPayload,
} from "../gateway/types.ts";

export type AthenaRawQueryOperation =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "ddl"
  | "transaction"
  | "unknown";

export type AthenaExpectedQueryShape =
  | "rows"
  | "single"
  | "maybe-single"
  | "affected-only"
  | "none";

export interface AthenaAdminQueryInput<
  TParams extends readonly unknown[] = readonly unknown[],
> {
  expectedShape: AthenaExpectedQueryShape;
  headers?: Record<string, string>;
  operation: AthenaRawQueryOperation;
  params?: TParams;
  signal?: AbortSignal;
  sql: string;
}

export interface AthenaAdminQueryExecutionMetadata {
  /** null means unknown — never fabricate 0 when meta is absent. */
  affectedRows: number | null;
  backend: "postgres" | "d1" | "scylla" | "supabase" | "unknown";
  deprecated: boolean;
  expectedShape: AthenaExpectedQueryShape;
  lastInsertId: string | number | null;
  operation: AthenaRawQueryOperation;
  route: string;
  transport: "gateway" | "d1-binding" | "d1-http-proxy" | "direct" | "unknown";
}

export interface AthenaAdminQueryResult<T = unknown> extends AthenaResult<T> {
  metadata: AthenaAdminQueryExecutionMetadata;
}

export const ATHENA_RAW_SQL_COMPAT_DEPRECATED =
  "ATHENA_RAW_SQL_COMPAT_DEPRECATED" as const;

export const ATHENA_ADMIN_QUERY_EMPTY_SQL =
  "ATHENA_ADMIN_QUERY_EMPTY_SQL" as const;

export const ATHENA_ADMIN_QUERY_MULTI_STATEMENT =
  "ATHENA_ADMIN_QUERY_MULTI_STATEMENT" as const;

export const ATHENA_ADMIN_QUERY_INVALID_SHAPE =
  "ATHENA_ADMIN_QUERY_INVALID_SHAPE" as const;

const ROW_SHAPES: ReadonlySet<AthenaExpectedQueryShape> = new Set([
  "rows",
  "single",
  "maybe-single",
]);

const AFFECTED_SHAPES: ReadonlySet<AthenaExpectedQueryShape> = new Set([
  "affected-only",
  "none",
]);

/** Reject empty SQL. */
export function assertNonEmptySql(sql: string): string {
  const normalized = sql.trim();
  if (!normalized) {
    const error = new Error("admin.query requires a non-empty sql string");
    (error as Error & { code?: string }).code = ATHENA_ADMIN_QUERY_EMPTY_SQL;
    throw error;
  }
  return normalized;
}

/**
 * Conservative multi-statement detection (semicolon outside simple quotes).
 * Does not attempt a full SQL parser.
 */
export function sqlLooksLikeMultipleStatements(sql: string): boolean {
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (!(inSingle || inDouble)) {
      if (ch === "-" && next === "-") {
        inLineComment = true;
        i += 1;
        continue;
      }
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        i += 1;
        continue;
      }
    }
    if (ch === "'" && !inDouble) {
      if (inSingle && next === "'") {
        i += 1;
        continue;
      }
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!(inSingle || inDouble) && ch === ";") {
      const rest = sql.slice(i + 1).trim();
      if (rest.length > 0) {
        return true;
      }
    }
  }
  return false;
}

/** Validate operation / expectedShape combinations fail-closed. */
export function assertValidAdminQueryShape(
  operation: AthenaRawQueryOperation,
  expectedShape: AthenaExpectedQueryShape
): void {
  if (operation === "select" && AFFECTED_SHAPES.has(expectedShape)) {
    const error = new Error(
      `admin.query: operation "select" is incompatible with expectedShape "${expectedShape}"`
    );
    (error as Error & { code?: string }).code =
      ATHENA_ADMIN_QUERY_INVALID_SHAPE;
    throw error;
  }
  if (
    (operation === "insert" ||
      operation === "update" ||
      operation === "delete") &&
    expectedShape === "none"
  ) {
    // allowed (caller ignores rows)
    return;
  }
  if (
    (operation === "insert" ||
      operation === "update" ||
      operation === "delete") &&
    ROW_SHAPES.has(expectedShape) === false &&
    expectedShape !== "affected-only"
  ) {
    // ddl/transaction/unknown may use any shape
  }
}

/**
 * Conservative SQL classification for legacy root query().
 * Prefer explicit operation on admin.query().
 */
export function classifyRawSqlOperation(sql: string): AthenaRawQueryOperation {
  const head = sql.trim().replace(/^\(+/, "").slice(0, 32).toLowerCase();
  if (head.startsWith("select") || head.startsWith("with")) {
    return "select";
  }
  if (head.startsWith("insert")) {
    return "insert";
  }
  if (head.startsWith("update")) {
    return "update";
  }
  if (head.startsWith("delete")) {
    return "delete";
  }
  if (
    head.startsWith("create") ||
    head.startsWith("alter") ||
    head.startsWith("drop") ||
    head.startsWith("truncate")
  ) {
    return "ddl";
  }
  if (
    head.startsWith("begin") ||
    head.startsWith("commit") ||
    head.startsWith("rollback")
  ) {
    return "transaction";
  }
  return "unknown";
}

export function defaultExpectedShapeForOperation(
  operation: AthenaRawQueryOperation
): AthenaExpectedQueryShape {
  if (operation === "select") {
    return "rows";
  }
  if (
    operation === "insert" ||
    operation === "update" ||
    operation === "delete"
  ) {
    return "affected-only";
  }
  return "rows";
}

function extractAffectedRows(
  raw: unknown,
  count: number | null | undefined,
  operation: AthenaRawQueryOperation,
  expectedShape: AthenaExpectedQueryShape
): number | null {
  // Honest mutation metadata: never treat SELECT (read) row-counts as affected rows.
  const isMutation =
    operation === "insert" || operation === "update" || operation === "delete";
  if (!isMutation && expectedShape !== "affected-only") {
    return null;
  }
  const resolved = resolveMutationAffectedRows({
    count,
    operation: isMutation || expectedShape === "affected-only" ? "update" : "select",
    raw,
  });
  return resolved === undefined ? null : resolved;
}

function extractLastInsertId(raw: unknown): string | number | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const candidates = [
    record.last_insert_id,
    record.lastInsertId,
    record.last_row_id,
    record.lastRowId,
  ];
  for (const candidate of candidates) {
    if (
      (typeof candidate === "string" && candidate.length > 0) ||
      (typeof candidate === "number" && Number.isFinite(candidate))
    ) {
      return candidate as string | number;
    }
  }
  return null;
}

function shapeResultData<T>(
  data: T | null,
  expectedShape: AthenaExpectedQueryShape
): T | null {
  if (data === null) {
    return data;
  }
  if (
    expectedShape === "rows" ||
    expectedShape === "affected-only" ||
    expectedShape === "none"
  ) {
    return data;
  }
  if (!Array.isArray(data)) {
    return data;
  }
  if (expectedShape === "single") {
    return (data[0] ?? null) as T;
  }
  if (expectedShape === "maybe-single") {
    return (data[0] ?? null) as T;
  }
  return data;
}

export interface CreateAdminQueryOptions {
  /**
   * When true, multi-statement SQL is forwarded to the gateway instead of
   * throwing `ATHENA_ADMIN_QUERY_MULTI_STATEMENT`.
   *
   * Used only by the legacy root `query()` compatibility alias so migration /
   * seed scripts keep working. Explicit `admin.query()` keeps the default
   * reject (allowMultiStatement omitted / false).
   */
  allowMultiStatement?: boolean;
  backend?: AthenaAdminQueryExecutionMetadata["backend"];
  client: Pick<AthenaGatewayClient, "queryGateway">;
  formatGatewayResult: AthenaResultFormatter;
  /** Transport hint for metadata honesty. */
  transport?: AthenaAdminQueryExecutionMetadata["transport"];
}

export function createAdminQuery(
  options: CreateAdminQueryOptions
): <T = unknown, TParams extends readonly unknown[] = readonly unknown[]>(
  input: AthenaAdminQueryInput<TParams>,
  callOptions?: AthenaGatewayCallOptions
) => Promise<AthenaAdminQueryResult<T>> {
  const {
    client,
    formatGatewayResult,
    transport = "gateway",
    backend = "unknown",
    allowMultiStatement = false,
  } = options;

  return async function adminQuery<
    T = unknown,
    TParams extends readonly unknown[] = readonly unknown[],
  >(
    input: AthenaAdminQueryInput<TParams>,
    callOptions?: AthenaGatewayCallOptions
  ): Promise<AthenaAdminQueryResult<T>> {
    const sql = assertNonEmptySql(input.sql);
    assertValidAdminQueryShape(input.operation, input.expectedShape);

    if (!allowMultiStatement && sqlLooksLikeMultipleStatements(sql)) {
      const error = new Error(
        "admin.query rejects multi-statement SQL by default"
      );
      (error as Error & { code?: string }).code =
        ATHENA_ADMIN_QUERY_MULTI_STATEMENT;
      throw error;
    }

    const params = input.params ?? callOptions?.params;
    const payload: AthenaQueryPayload = {
      query: sql,
      ...(Array.isArray(params) ? { params: [...params] } : {}),
      expectedShape: input.expectedShape,
      operation: input.operation,
    };

    const mergedOptions: AthenaGatewayCallOptions | undefined = {
      ...callOptions,
      ...(input.headers
        ? {
            headers: {
              ...(callOptions?.headers ?? {}),
              ...input.headers,
            },
          }
        : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    };

    const response = await client.queryGateway<T>(payload, mergedOptions);
    const formatted = formatGatewayResult(response, {
      operation: input.operation,
    });
    const shapedData = shapeResultData(formatted.data, input.expectedShape);
    const affectedRows = extractAffectedRows(
      formatted.raw,
      formatted.count,
      input.operation,
      input.expectedShape
    );
    const lastInsertId = extractLastInsertId(formatted.raw);

    return {
      ...formatted,
      data: shapedData,
      metadata: {
        affectedRows,
        backend,
        deprecated: true,
        expectedShape: input.expectedShape,
        lastInsertId,
        operation: input.operation,
        route: ATHENA_GATEWAY_ROUTES.rawQuery,
        transport,
      },
    };
  };
}

/** Per-client deprecation warning dedupe for root query(). */
const deprecationWarnedClients = new WeakSet<object>();

export type AthenaRawQueryDiagnosticsMode = boolean | "auto";

export function maybeWarnRawQueryDeprecated(
  owner: object,
  diagnostics: AthenaRawQueryDiagnosticsMode | undefined
): void {
  if (diagnostics === false) {
    return;
  }
  const nodeEnv = (globalThis as { process?: { env?: { NODE_ENV?: string } } })
    .process?.env?.NODE_ENV;
  const isDev = nodeEnv !== "production";
  const shouldWarn =
    diagnostics === true ||
    (diagnostics === "auto" && isDev) ||
    (diagnostics === undefined && isDev);
  if (!shouldWarn) {
    return;
  }
  if (deprecationWarnedClients.has(owner)) {
    return;
  }
  deprecationWarnedClients.add(owner);
  console.warn(
    `[athena] ${ATHENA_RAW_SQL_COMPAT_DEPRECATED}: athena.query() is a compatibility alias. Prefer athena.admin.query({ sql, operation, expectedShape }).`
  );
}
