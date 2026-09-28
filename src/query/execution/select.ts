import type { AthenaResult } from "../../result/types.ts";
import { executeRead } from "../../result/read.ts";
import {
  buildDebugSelectQuery,
  buildIncludeJoinSelectQuery,
  buildTypedSelectQuery,
  resolveTableNameForCall,
} from "../../client-sql.ts";
import type { AthenaGatewayCallOptions } from "../../gateway/types.ts";
import type { AthenaQueryTraceCallsite, TableBuilderState } from "../contracts.ts";
import type { AthenaQueryDebugAst } from "../../query-debug-ast.ts";
import type { AthenaQueryExecutionRuntime } from "./operation.ts";
import { buildSelectDebugAst } from "../../query-debug-ast.ts";
import { executeWithQueryTrace } from "../../query-tracing.ts";
import { createSelectTransportPlan } from "../../query-transport.ts";
import { createCanonicalSelect } from "./canonical-select.ts";

export interface AthenaSelectExecutionInput {
  tableName: string;
  columns: string | string[];
  state: TableBuilderState;
  options?: AthenaGatewayCallOptions;
  runtime: AthenaQueryExecutionRuntime;
  callsite?: AthenaQueryTraceCallsite | null;
  debugAstFactory?: (input: {
    tableName: string;
    columns: string | string[];
    executionState: TableBuilderState;
    plan: ReturnType<typeof createSelectTransportPlan>;
  }) => AthenaQueryDebugAst;
}

export async function executeAthenaSelect<T = unknown>(
  input: AthenaSelectExecutionInput
): Promise<AthenaResult<T>> {
  const {
    behavior,
    formatGatewayResult,
    gateway,
    tracer,
  } = input.runtime;
  const resolvedTableName = resolveTableNameForCall(
    input.tableName,
    input.options?.schema
  );
  if (
    behavior?.canonicalQueries &&
    !input.options?.count &&
    !input.options?.head
  ) {
    const canonical = createCanonicalSelect({
      columns: input.columns,
      state: input.state,
      tableName: resolvedTableName,
    });
    if (canonical) {
      const debugAst = behavior.debugAst
        ? input.debugAstFactory?.({
            columns: input.columns,
            executionState: input.state,
            plan: createSelectTransportPlan({
              buildTypedSelectQuery,
              columns: input.columns,
              options: input.options,
              state: input.state,
              tableName: resolvedTableName,
            }),
            tableName: resolvedTableName,
          })
        : undefined;
      return executeRead(behavior, () =>
        executeWithQueryTrace(
          tracer,
          {
            ast: debugAst,
            endpoint: "/gateway/fetch",
            operation: "select",
            options: input.options,
            payload: canonical.ast,
            sql: buildDebugSelectQuery({
              columns: input.columns,
              conditions: input.state.conditions,
              limit: input.state.limit,
              offset: input.state.offset,
              order: input.state.order,
              tableName: resolvedTableName,
            }),
            table: resolvedTableName,
          },
          async () => {
            const response = await gateway.fetchGateway<T>(
              canonical.ast,
              input.options
            );
            return formatGatewayResult(response, {
              operation: "select",
              table: resolvedTableName,
            });
          },
          input.callsite
        )
      );
    }
  }
  const plan = createSelectTransportPlan({
    buildTypedSelectQuery,
    columns: input.columns,
    options: input.options,
    state: input.state,
    tableName: resolvedTableName,
  });
  const debugAst = behavior?.debugAst
    ? (input.debugAstFactory?.({
        columns: input.columns,
        executionState: input.state,
        plan,
        tableName: resolvedTableName,
      }) ??
      buildSelectDebugAst({
        columns: input.columns,
        plan,
        state: input.state,
        tableName: resolvedTableName,
      }))
    : undefined;
  const includeSql =
    input.state.relations && input.state.relations.length > 0
      ? buildIncludeJoinSelectQuery({
          columns: input.columns,
          conditions: input.state.conditions,
          limit: input.state.limit,
          offset: input.state.offset,
          order: input.state.order,
          relations: input.state.relations,
          tableName: resolvedTableName,
        })
      : null;

  if (plan.kind === "query") {
    return executeRead(behavior, () =>
      executeWithQueryTrace(
        tracer,
        {
          ast: debugAst,
          endpoint: "/gateway/query",
          operation: "select",
          options: input.options,
          payload: plan.payload,
          sql: includeSql ?? plan.query,
          table: resolvedTableName,
        },
        async () => {
          const response = await gateway.queryGateway<T>(
            plan.payload,
            input.options
          );
          return formatGatewayResult(response, {
            operation: "select",
            table: resolvedTableName,
          });
        },
        input.callsite
      )
    );
  }

  const sql =
    includeSql ??
    buildDebugSelectQuery({
      tableName: resolvedTableName,
      ...plan.debug,
    });
  return executeRead(behavior, () =>
    executeWithQueryTrace(
      tracer,
      {
        ast: debugAst,
        endpoint: "/gateway/fetch",
        operation: "select",
        options: input.options,
        payload: plan.payload,
        sql,
        table: resolvedTableName,
      },
      async () => {
        const response = await gateway.fetchGateway<T>(
          plan.payload,
          input.options
        );
        return formatGatewayResult(response, {
          operation: "select",
          table: resolvedTableName,
        });
      },
      input.callsite
    )
  );
}
