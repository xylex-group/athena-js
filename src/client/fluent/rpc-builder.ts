import type { AthenaResult } from "../../client-result.ts";
import { toSingleResult } from "../../client-result.ts";
import {
  buildRpcDebugSql,
} from "../../client-sql.ts";
import type {
  AthenaConditionArrayValue,
  AthenaConditionValue,
  AthenaJsonObject,
  AthenaRpcCallOptions,
  AthenaRpcFilter,
  AthenaRpcFilterOperator,
  AthenaRpcPayload,
} from "../../gateway/types.ts";
import type { AthenaQueryExecutionRuntime } from "../../query/execution/operation.ts";
import {
  captureTraceCallsite,
  createTraceCallsiteStore,
  executeWithQueryTrace,
} from "../../query-tracing.ts";
import { buildRpcDebugAst } from "../../query-debug-ast.ts";
import type { AthenaSelectInput } from "../../select-column-types.ts";
import {
  normalizeSelectColumnsInput,
} from "./state.ts";
import type { RpcOrderOptions, RpcQueryBuilder } from "./types.ts";

function toRpcSelect(columns?: AthenaSelectInput) {
  if (!columns) {
    return;
  }
  return typeof columns === "string" ? columns : columns.join(",");
}

function createRpcFilterMethods<Self>(
  filters: AthenaRpcFilter[],
  self: Self
) {
  const addFilter = (
    operator: AthenaRpcFilterOperator,
    column: string,
    value: AthenaConditionValue | AthenaConditionArrayValue | string
  ) => {
    filters.push({ column, operator, value });
  };

  return {
    eq(column: string, value: AthenaConditionValue) {
      addFilter("eq", column, value);
      return self;
    },
    gt(column: string, value: AthenaConditionValue) {
      addFilter("gt", column, value);
      return self;
    },
    gte(column: string, value: AthenaConditionValue) {
      addFilter("gte", column, value);
      return self;
    },
    ilike(column: string, value: AthenaConditionValue) {
      addFilter("ilike", column, value);
      return self;
    },
    in(column: string, values: AthenaConditionArrayValue) {
      addFilter("in", column, values);
      return self;
    },
    is(column: string, value: AthenaConditionValue) {
      addFilter("is", column, value);
      return self;
    },
    like(column: string, value: AthenaConditionValue) {
      addFilter("like", column, value);
      return self;
    },
    lt(column: string, value: AthenaConditionValue) {
      addFilter("lt", column, value);
      return self;
    },
    lte(column: string, value: AthenaConditionValue) {
      addFilter("lte", column, value);
      return self;
    },
    neq(column: string, value: AthenaConditionValue) {
      addFilter("neq", column, value);
      return self;
    },
  };
}

export function createRpcBuilder<Row>(
  functionName: string,
  args: AthenaJsonObject | undefined,
  baseOptions: AthenaRpcCallOptions | undefined,
  runtime: AthenaQueryExecutionRuntime,
  initialCallsite?: import("./types.ts").AthenaQueryTraceCallsite | null
): RpcQueryBuilder<Row> {
  const {
    formatGatewayResult,
    gateway: client,
    tracer,
    behavior,
  } = runtime;
  const state: {
    filters: AthenaRpcFilter[];
    limit?: number;
    offset?: number;
    order?: { column: string; ascending?: boolean };
  } = { filters: [] };
  let selectedColumns: AthenaSelectInput | undefined;
  let selectedOptions: AthenaRpcCallOptions | undefined;
  let promise: Promise<AthenaResult<Row[]>> | null = null;
  const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);

  const executeRpc = async <SelectedRow = Row>(
    columns?: AthenaSelectInput,
    options?: AthenaRpcCallOptions,
    callsite?: import("./types.ts").AthenaQueryTraceCallsite | null
  ): Promise<AthenaResult<SelectedRow[]>> => {
    const mergedOptions = mergeOptions(baseOptions, options);
    const normalizedSelectedColumns = normalizeSelectColumnsInput(columns);
    const payload: AthenaRpcPayload = {
      args,
      count: mergedOptions?.count,
      filters: state.filters.length ? [...state.filters] : undefined,
      function: functionName,
      head: mergedOptions?.head,
      limit: state.limit,
      offset: state.offset,
      order: state.order,
      schema: mergedOptions?.schema,
      select: toRpcSelect(columns),
    };
    const endpoint: import("./types.ts").AthenaQueryTraceEvent["endpoint"] =
      mergedOptions?.get ? `/rpc/${functionName}` : "/gateway/rpc";
    const sql = buildRpcDebugSql(payload);
    const debugAst = behavior?.debugAst
      ? buildRpcDebugAst({
          args,
          endpoint,
          functionName,
          payload,
          selectedColumns: normalizedSelectedColumns,
          state,
        })
      : undefined;
    return executeWithQueryTrace(
      tracer,
      {
        ast: debugAst,
        endpoint,
        functionName,
        operation: "rpc",
        options: mergedOptions,
        payload,
        sql,
      },
      async () => {
        const response = await client.rpcGateway<SelectedRow[]>(
          payload,
          mergedOptions
        );
        return formatGatewayResult(response, { operation: "rpc" });
      },
      callsite
    );
  };

  const run = (
    columns?: AthenaSelectInput,
    options?: AthenaRpcCallOptions,
    callsite?: import("./types.ts").AthenaQueryTraceCallsite | null
  ) => {
    const payloadColumns = columns ?? selectedColumns;
    const payloadOptions = options ?? selectedOptions;
    if (!promise) {
      promise = executeRpc<Row>(
        payloadColumns,
        payloadOptions,
        callsiteStore.resolve(callsite)
      );
    }
    return promise;
  };

  const builder = {} as RpcQueryBuilder<Row>;
  const filterMethods = createRpcFilterMethods(state.filters, builder);
  Object.assign(builder, filterMethods, {
    catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
      return run(selectedColumns, selectedOptions).catch(onrejected);
    },
    finally(onfinally?: () => void) {
      return run(selectedColumns, selectedOptions).finally(onfinally);
    },
    limit(count: number) {
      state.limit = count;
      return builder;
    },
    maybeSingle<T = Row>(
      columns?: AthenaSelectInput,
      options?: AthenaRpcCallOptions
    ) {
      return builder.single<T, AthenaSelectInput>(columns, options);
    },
    offset(count: number) {
      state.offset = count;
      return builder;
    },
    order(column: string, options?: RpcOrderOptions) {
      state.order = { ascending: options?.ascending ?? true, column };
      return builder;
    },
    range(from: number, to: number) {
      state.offset = from;
      state.limit = to - from + 1;
      return builder;
    },
    select(columns?: AthenaSelectInput, options?: AthenaRpcCallOptions) {
      selectedColumns = columns;
      selectedOptions = options ?? selectedOptions;
      return run(columns, options, captureTraceCallsite(tracer));
    },
    async single<T = Row>(
      columns?: AthenaSelectInput,
      options?: AthenaRpcCallOptions
    ) {
      const result = await run(
        columns,
        options,
        captureTraceCallsite(tracer)
      );
      return toSingleResult(result) as AthenaResult<T | null>;
    },
    then<T1 = AthenaResult<Row[]>, T2 = never>(
      onfulfilled?: (v: AthenaResult<Row[]>) => T1 | PromiseLike<T1>,
      onrejected?: (reason: unknown) => T2 | PromiseLike<T2>
    ) {
      return run(selectedColumns, selectedOptions).then(
        onfulfilled,
        onrejected
      );
    },
  });
  return builder;
}

function mergeOptions<T extends { headers?: Record<string, string> }>(
  ...options: Array<T | undefined>
): T | undefined {
  return options.reduce<T | undefined>((acc, next) => {
    if (!next) {
      return acc;
    }
    const merged = { ...(acc ?? {}), ...next } as T;
    if (acc?.headers || next.headers) {
      merged.headers = {
        ...(acc?.headers ?? {}),
        ...(next.headers ?? {}),
      };
    }
    return merged;
  }, undefined);
}
