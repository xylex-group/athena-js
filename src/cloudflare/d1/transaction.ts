import { AthenaGatewayError } from "../../gateway/errors.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";
import { AthenaTransactionError } from "../../db/transaction/errors.ts";
import type {
  AthenaResolvedTransactionOptions,
  AthenaTransactionOperation,
  AthenaTransactionTransport,
  AthenaTransactionTransportResult,
} from "../../db/transaction/types.ts";
import { D1_BATCH_TRANSACTION_CAPABILITIES } from "../../db/transaction/types.ts";
import type { D1DatabaseLike, D1ResultLike } from "../types.ts";
import { executeD1Batch } from "./runner.ts";
import {
  compileD1Delete,
  compileD1Fetch,
  compileD1Insert,
  compileD1Update,
  type D1CompiledSql,
  type D1CompileOptions,
  D1SqlCompileError,
} from "./sql.ts";

function d1ErrorResponse<T>(
  message: string,
  hint?: string
): AthenaGatewayResponse<T> {
  const error = new AthenaGatewayError({
    code: "HTTP_ERROR",
    endpoint: "/gateway/transaction" as never,
    hint,
    message,
    method: "POST",
    status: 400,
  });
  return {
    data: null,
    error: error.message,
    errorDetails: error.toDetails(),
    ok: false,
    raw: { code: "HTTP_ERROR", error: message },
    status: 400,
    statusText: null,
  };
}

function stripNullsFromRows(rows: unknown[], strip: boolean): unknown[] {
  if (!strip) {
    return rows;
  }
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

function flattenCompiled(compiled: D1CompiledSql): {
  params?: unknown[];
  query: string;
}[] {
  if (compiled.statements && compiled.statements.length > 0) {
    return compiled.statements.map((statement) => ({
      params: statement.params,
      query: statement.sql,
    }));
  }
  return [{ params: compiled.params, query: compiled.sql }];
}

function mapSlice(
  operation: AthenaTransactionOperation,
  compiled: D1CompiledSql,
  slice: D1ResultLike<unknown>[],
  callOptions?: AthenaGatewayCallOptions
): AthenaGatewayResponse<unknown> {
  const failed = slice.find((item) => item.success === false || item.error);
  if (failed) {
    return d1ErrorResponse(
      failed.error ?? "D1 statement failed",
      `operation ${operation.id} (${operation.kind})`
    );
  }
  const strip =
    typeof callOptions?.stripNulls === "boolean" ? callOptions.stripNulls : true;
  const rows = stripNullsFromRows(
    slice.flatMap((item) => (Array.isArray(item.results) ? item.results : [])),
    strip
  );
  const changes = slice.reduce((sum, item) => {
    const n =
      item.meta && typeof item.meta.changes === "number"
        ? item.meta.changes
        : 0;
    return sum + n;
  }, 0);
  const count = rows.length > 0 ? rows.length : changes;
  let data: unknown = rows;
  if (
    operation.kind === "insert" &&
    !Array.isArray((operation.payload as AthenaInsertPayload).insert_body) &&
    rows.length === 1
  ) {
    data = rows[0];
  } else if (operation.kind === "update" && rows.length === 1) {
    data = rows[0];
  }
  void compiled;
  return {
    count,
    data,
    error: undefined,
    errorDetails: null,
    ok: true,
    raw: slice,
    status: 200,
    statusText: "OK",
  };
}

export function createD1TransactionTransport(input: {
  compileOptionsForBoundedMutation: (
    payload: {
      current_page?: number;
      limit?: number;
      offset?: number;
      page_size?: number;
      sort_by?: unknown;
      table_name?: string;
    },
    callOptions?: AthenaGatewayCallOptions
  ) => Promise<D1CompileOptions | undefined>;
  d1: D1DatabaseLike;
  sessionFromOptions: (callOptions?: AthenaGatewayCallOptions) => {
    bookmark?: string | null;
    sessionMode?: string | null;
  };
}): AthenaTransactionTransport {
  return {
    capabilities: D1_BATCH_TRANSACTION_CAPABILITIES,
    async executeAtomic(
      operations: readonly AthenaTransactionOperation[],
      options?: AthenaResolvedTransactionOptions
    ): Promise<AthenaTransactionTransportResult> {
      const compiledList: D1CompiledSql[] = [];
      const statementRanges: Array<{ end: number; start: number }> = [];
      const statements: { params?: unknown[]; query: string }[] = [];
      try {
        for (const operation of operations) {
          let compiled: D1CompiledSql;
          switch (operation.kind) {
            case "fetch":
              compiled = compileD1Fetch(operation.payload as AthenaFetchPayload);
              break;
            case "insert":
              compiled = compileD1Insert(
                operation.payload as AthenaInsertPayload
              );
              break;
            case "update":
              compiled = compileD1Update(
                operation.payload as AthenaUpdatePayload,
                await input.compileOptionsForBoundedMutation(
                  operation.payload as AthenaUpdatePayload,
                  options?.callOptions
                )
              );
              break;
            case "delete":
              compiled = compileD1Delete(
                operation.payload as AthenaDeletePayload,
                await input.compileOptionsForBoundedMutation(
                  operation.payload as AthenaDeletePayload,
                  options?.callOptions
                )
              );
              break;
            default:
              throw new AthenaTransactionError(
                "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
                "Unsupported D1 transaction operation"
              );
          }
          const flat = flattenCompiled(compiled);
          const start = statements.length;
          statements.push(...flat);
          compiledList.push(compiled);
          statementRanges.push({ end: statements.length, start });
        }
      } catch (error) {
        if (error instanceof D1SqlCompileError) {
          throw new AthenaTransactionError(
            "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
            error.message,
            { code: error.code }
          );
        }
        throw error;
      }

      const session = input.sessionFromOptions(options?.callOptions);
      const batch = await executeD1Batch(input.d1, {
        statements,
        ...session,
      });
      if (!batch.ok) {
        return {
          committed: false,
          results: operations.map((operation) =>
            d1ErrorResponse(batch.message, operation.kind)
          ),
        };
      }

      const results = operations.map((operation, index) => {
        const range = statementRanges[index]!;
        return mapSlice(
          operation,
          compiledList[index]!,
          batch.results.slice(range.start, range.end),
          options?.callOptions
        );
      });
      return {
        committed: results.every((result) => result.ok),
        results,
      };
    },
  };
}
