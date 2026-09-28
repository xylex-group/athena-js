import {
  classifyRawSqlOperation,
  createAdminQuery,
  defaultExpectedShapeForOperation,
  maybeWarnRawQueryDeprecated,
} from "../admin/query.ts";
import type { AthenaGatewayCallOptions } from "../gateway/types.ts";
import type { AthenaQueryExecutionRuntime } from "../query/execution/operation.ts";
import { buildRawQueryDebugAst } from "../query-debug-ast.ts";
import {
  captureTraceCallsite,
  executeWithQueryTrace,
} from "../query-tracing.ts";
import { executeRead } from "../result/read.ts";
import type { AthenaResult } from "../result/types.ts";

export function createCompatibilityQueryBuilder(
  runtime: AthenaQueryExecutionRuntime,
  deprecationOwner?: object,
) {
  const { behavior, formatGatewayResult, gateway, tracer } = runtime;
  const debugAstEnabled = Boolean(behavior?.debugAst);
  const adminQuery = createAdminQuery({
    allowMultiStatement: true,
    client: gateway,
    formatGatewayResult,
  });

  return async function query<Row = unknown>(
    sql: string,
    options?: AthenaGatewayCallOptions,
  ): Promise<AthenaResult<Row[]>> {
    if (deprecationOwner) {
      maybeWarnRawQueryDeprecated(
        deprecationOwner,
        behavior?.rawQueryDiagnostics,
      );
    }
    const normalizedQuery = sql.trim();
    if (!normalizedQuery) {
      throw new Error("query requires a non-empty string");
    }
    const operation = classifyRawSqlOperation(normalizedQuery);
    const expectedShape = defaultExpectedShapeForOperation(operation);
    const params = options?.params;
    const payload = {
      query: normalizedQuery,
      ...(Array.isArray(params) ? { params } : {}),
      expectedShape,
      operation,
    };
    const callsite = captureTraceCallsite(tracer);
    return executeRead(behavior, () =>
      executeWithQueryTrace(
        tracer,
        {
          ast: debugAstEnabled
            ? buildRawQueryDebugAst(normalizedQuery)
            : undefined,
          endpoint: "/gateway/query",
          operation: "query",
          options,
          payload,
          sql: normalizedQuery,
        },
        async () => {
          const result = await adminQuery<Row[]>(
            {
              sql: normalizedQuery,
              ...(Array.isArray(params) ? { params } : {}),
              expectedShape: "rows",
              operation,
            },
            options,
          );
          const { metadata: _metadata, ...legacy } = result;
          void _metadata;
          return legacy;
        },
        callsite,
      ),
    );
  };
}
