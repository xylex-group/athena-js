import { AthenaGatewayError } from "../gateway/errors.ts";
import { resolveMutationAffectedRows } from "../result/mutation-meta.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import type { AthenaPostgresQueryable } from "./driver.ts";
import {
  mapPostgresDriverError,
  sanitizePostgresMessage,
} from "./errors.ts";
import {
  type PostgresIdentityCache,
  needsBoundedIdentity,
  resolvePostgresBoundedIdentityColumn,
} from "./identity.ts";
import { AthenaQueryError } from "../query/engine/index.ts";
import {
  compilePostgresStructuredCount,
  compilePostgresStructuredFetch,
  needsPostgresAstPipeline,
} from "./compile-fetch.ts";
import {
  compilePostgresCount,
  compilePostgresDelete,
  compilePostgresFetch,
  compilePostgresInsert,
  compilePostgresUpdate,
  extractAthenaCount,
  type PostgresCompiledQuery,
  type PostgresCompileOptions,
  PostgresSqlCompileError,
} from "./sql.ts";

export function resolvePostgresStripNulls(
  payloadStrip: boolean | undefined,
  callOptions: AthenaGatewayCallOptions | undefined,
  defaultValue: boolean
): boolean {
  if (typeof payloadStrip === "boolean") {
    return payloadStrip;
  }
  if (typeof callOptions?.stripNulls === "boolean") {
    return callOptions.stripNulls;
  }
  return defaultValue;
}

export function stripNullPropertiesFromRows(rows: unknown[]): unknown[] {
  return rows.map((row) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return row;
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
      if (value !== null) {
        out[key] = value;
      }
    }
    return out;
  });
}

export function maybeStripNullRows(rows: unknown[], strip: boolean): unknown[] {
  return strip ? stripNullPropertiesFromRows(rows) : rows;
}

export function postgresSuccessResponse<T>(
  data: T,
  count: number | null | undefined,
  raw: unknown,
  affectedRows?: number | null
): AthenaGatewayResponse<T> {
  return {
    ...(affectedRows !== undefined ? { affectedRows } : {}),
    count: count ?? null,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw,
    status: 200,
    statusText: "OK",
  };
}

export function postgresErrorResponse<T>(
  status: number,
  code:
    | "HTTP_ERROR"
    | "UNKNOWN_ERROR"
    | "INVALID_JSON"
    | "NETWORK_ERROR"
    | "INVALID_URL",
  message: string,
  endpoint: string,
  method: string,
  hint?: string
): AthenaGatewayResponse<T> {
  const error = new AthenaGatewayError({
    code,
    endpoint: endpoint as never,
    hint,
    message,
    method: method as never,
    status,
  });
  return {
    data: null,
    error: error.message,
    errorDetails: error.toDetails(),
    ok: false,
    raw: { code, error: message },
    status,
    statusText: null,
  };
}

export function postgresCompileErrorResponse<T>(
  error: unknown,
  endpoint: string,
  method: string
): AthenaGatewayResponse<T> {
  if (error instanceof PostgresSqlCompileError) {
    return postgresErrorResponse(
      400,
      "HTTP_ERROR",
      error.message,
      endpoint,
      method,
      `PostgreSQL SQL compile failed (${error.code})`
    );
  }
  if (error instanceof AthenaQueryError) {
    return postgresErrorResponse(
      400,
      "HTTP_ERROR",
      error.message,
      endpoint,
      method,
      `Athena query compile failed (${error.code})`
    );
  }
  const mapped = mapPostgresDriverError(error);
  return postgresErrorResponse(
    mapped.status,
    mapped.code,
    mapped.message,
    endpoint,
    method,
    mapped.hint
  );
}

export function mapPostgresQueryError<T>(
  error: unknown,
  endpoint: string,
  method: string
): AthenaGatewayResponse<T> {
  if (error instanceof PostgresSqlCompileError) {
    return postgresCompileErrorResponse(error, endpoint, method);
  }
  const mapped = mapPostgresDriverError(error);
  return postgresErrorResponse(
    mapped.status,
    mapped.code,
    sanitizePostgresMessage(mapped.message),
    endpoint,
    method,
    mapped.hint
  );
}

export async function executePostgresCompiled<T>(input: {
  compiled: PostgresCompiledQuery;
  endpoint: string;
  mapResult?: (
    rows: unknown[],
    rowCount: number
  ) => { count: number | null; data: T };
  method: string;
  queryable: AthenaPostgresQueryable;
  stripNulls?: boolean;
}): Promise<AthenaGatewayResponse<T>> {
  try {
    const result = await input.queryable.query(
      input.compiled.text,
      input.compiled.values
    );
    const strip = input.stripNulls ?? true;
    const rows = maybeStripNullRows(result.rows as unknown[], strip);
    const rowCount =
      typeof result.rowCount === "number" ? result.rowCount : rows.length;
    const mapped = input.mapResult?.(rows, rowCount) ?? {
      count: rowCount,
      data: rows as T,
    };
    const affectedRows = resolveMutationAffectedRows({
      count:
        typeof result.rowCount === "number"
          ? result.rowCount
          : mapped.count ?? null,
      endpoint: input.endpoint,
      raw: result,
    });
    return postgresSuccessResponse(
      mapped.data,
      mapped.count,
      result,
      affectedRows
    );
  } catch (error) {
    return mapPostgresQueryError(error, input.endpoint, input.method);
  }
}

export async function resolvePostgresMutationCompileOptions(input: {
  cache: PostgresIdentityCache;
  defaultIdentityColumn?: string;
  payload: {
    current_page?: number;
    limit?: number;
    offset?: number;
    page_size?: number;
    sort_by?: unknown;
    table_name?: string;
  };
  queryable: AthenaPostgresQueryable;
}): Promise<PostgresCompileOptions | undefined> {
  if (!needsBoundedIdentity(input.payload)) {
    return undefined;
  }
  const hasPage =
    input.payload.limit !== undefined ||
    input.payload.offset !== undefined ||
    input.payload.page_size !== undefined ||
    input.payload.current_page !== undefined;
  if (!hasPage) {
    return undefined;
  }
  if (input.defaultIdentityColumn) {
    return { identityColumn: input.defaultIdentityColumn };
  }
  const identityColumn = await resolvePostgresBoundedIdentityColumn(
    input.queryable,
    input.payload.table_name ?? "",
    input.cache
  );
  return { identityColumn };
}

export async function executePostgresFetch<T>(input: {
  callOptions?: AthenaGatewayCallOptions;
  payload: AthenaFetchPayload;
  queryable: AthenaPostgresQueryable;
}): Promise<AthenaGatewayResponse<T>> {
  try {
    const compiled = needsPostgresAstPipeline(input.payload)
      ? await compilePostgresStructuredFetch(input.payload, input.queryable)
      : compilePostgresFetch(input.payload);
    const stripNulls = resolvePostgresStripNulls(
      input.payload.strip_nulls,
      input.callOptions,
      true
    );
    if (input.payload.head === true) {
      return executePostgresCompiled({
        compiled,
        endpoint: "/gateway/fetch",
        mapResult: (rows) => ({ count: extractAthenaCount(rows), data: [] as T }),
        method: "POST",
        queryable: input.queryable,
        stripNulls: false,
      });
    }
    const wantsTotalCount =
      input.payload.count === "exact" ||
      input.payload.count === "planned" ||
      input.payload.count === "estimated";
    if (wantsTotalCount) {
      const countCompiled = needsPostgresAstPipeline(input.payload)
        ? await compilePostgresStructuredCount(input.payload, input.queryable)
        : compilePostgresCount(input.payload);
      const [dataResult, countResult] = await Promise.all([
        input.queryable.query(compiled.text, compiled.values),
        input.queryable.query(countCompiled.text, countCompiled.values),
      ]);
      const rows = maybeStripNullRows(
        dataResult.rows as unknown[],
        stripNulls
      );
      const total = extractAthenaCount(countResult.rows as unknown[]);
      return postgresSuccessResponse(rows as T, total, {
        count: countResult,
        data: dataResult,
      });
    }
    return executePostgresCompiled({
      compiled,
      endpoint: "/gateway/fetch",
      mapResult: (rows) => ({ count: rows.length, data: rows as T }),
      method: "POST",
      queryable: input.queryable,
      stripNulls,
    });
  } catch (error) {
    return postgresCompileErrorResponse(error, "/gateway/fetch", "POST");
  }
}

export async function executePostgresInsert<T>(input: {
  callOptions?: AthenaGatewayCallOptions;
  payload: AthenaInsertPayload;
  queryable: AthenaPostgresQueryable;
}): Promise<AthenaGatewayResponse<T>> {
  try {
    const compiled = compilePostgresInsert(input.payload);
    const stripNulls = resolvePostgresStripNulls(
      undefined,
      input.callOptions,
      true
    );
    return executePostgresCompiled({
      compiled,
      endpoint: "/gateway/insert",
      mapResult: (rows, rowCount) => {
        if (!Array.isArray(input.payload.insert_body) && rows.length === 1) {
          return { count: rowCount, data: rows[0] as T };
        }
        return { count: rowCount, data: rows as T };
      },
      method: "PUT",
      queryable: input.queryable,
      stripNulls,
    });
  } catch (error) {
    return postgresCompileErrorResponse(error, "/gateway/insert", "PUT");
  }
}

export async function executePostgresUpdate<T>(input: {
  cache: PostgresIdentityCache;
  callOptions?: AthenaGatewayCallOptions;
  defaultIdentityColumn?: string;
  payload: AthenaUpdatePayload;
  queryable: AthenaPostgresQueryable;
}): Promise<AthenaGatewayResponse<T>> {
  try {
    const compileOptions = await resolvePostgresMutationCompileOptions({
      cache: input.cache,
      defaultIdentityColumn: input.defaultIdentityColumn,
      payload: input.payload,
      queryable: input.queryable,
    });
    const compiled = compilePostgresUpdate(input.payload, compileOptions);
    const stripNulls = resolvePostgresStripNulls(
      input.payload.strip_nulls,
      input.callOptions,
      true
    );
    return executePostgresCompiled({
      compiled,
      endpoint: "/gateway/update",
      mapResult: (rows, rowCount) => {
        if (rows.length === 1) {
          return { count: rowCount, data: rows[0] as T };
        }
        return { count: rowCount, data: rows as T };
      },
      method: "POST",
      queryable: input.queryable,
      stripNulls,
    });
  } catch (error) {
    return postgresCompileErrorResponse(error, "/gateway/update", "POST");
  }
}

export async function executePostgresDelete<T>(input: {
  cache: PostgresIdentityCache;
  callOptions?: AthenaGatewayCallOptions;
  defaultIdentityColumn?: string;
  payload: AthenaDeletePayload;
  queryable: AthenaPostgresQueryable;
}): Promise<AthenaGatewayResponse<T>> {
  try {
    const compileOptions = await resolvePostgresMutationCompileOptions({
      cache: input.cache,
      defaultIdentityColumn: input.defaultIdentityColumn,
      payload: input.payload,
      queryable: input.queryable,
    });
    const compiled = compilePostgresDelete(input.payload, compileOptions);
    const stripNulls = resolvePostgresStripNulls(
      undefined,
      input.callOptions,
      true
    );
    return executePostgresCompiled({
      compiled,
      endpoint: "/gateway/delete",
      method: "DELETE",
      queryable: input.queryable,
      stripNulls,
    });
  } catch (error) {
    return postgresCompileErrorResponse(error, "/gateway/delete", "DELETE");
  }
}

export async function executePostgresTransactionOperation<T>(input: {
  cache: PostgresIdentityCache;
  callOptions?: AthenaGatewayCallOptions;
  defaultIdentityColumn?: string;
  operation: {
    kind: "fetch" | "insert" | "update" | "delete";
    payload:
      | AthenaFetchPayload
      | AthenaInsertPayload
      | AthenaUpdatePayload
      | AthenaDeletePayload;
  };
  queryable: AthenaPostgresQueryable;
}): Promise<AthenaGatewayResponse<T>> {
  switch (input.operation.kind) {
    case "fetch":
      return executePostgresFetch({
        callOptions: input.callOptions,
        payload: input.operation.payload as AthenaFetchPayload,
        queryable: input.queryable,
      });
    case "insert":
      return executePostgresInsert({
        callOptions: input.callOptions,
        payload: input.operation.payload as AthenaInsertPayload,
        queryable: input.queryable,
      });
    case "update":
      return executePostgresUpdate({
        cache: input.cache,
        callOptions: input.callOptions,
        defaultIdentityColumn: input.defaultIdentityColumn,
        payload: input.operation.payload as AthenaUpdatePayload,
        queryable: input.queryable,
      });
    case "delete":
      return executePostgresDelete({
        cache: input.cache,
        callOptions: input.callOptions,
        defaultIdentityColumn: input.defaultIdentityColumn,
        payload: input.operation.payload as AthenaDeletePayload,
        queryable: input.queryable,
      });
    default:
      return postgresErrorResponse(
        400,
        "HTTP_ERROR",
        "Unsupported transaction operation",
        "/gateway/transaction",
        "POST"
      );
  }
}
