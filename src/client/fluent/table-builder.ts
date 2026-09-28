import type { AthenaResult } from "../../result/types.ts";
import { applyCardinality } from "../../result/cardinality.ts";
import { executeRead } from "../../result/read.ts";
import {
  buildDebugSelectQuery,
  buildDeleteDebugSql,
  buildInsertDebugSql,
  buildTypedSelectQuery,
  buildUpdateDebugSql,
  resolveTableNameForCall,
} from "../../client-sql.ts";
import type {
  AthenaConditionArrayValue,
  AthenaConditionCastType,
  AthenaConditionOperator,
  AthenaConditionValue,
  AthenaDeletePayload,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaRpcCallOptions,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";

export type {
  AthenaRequestMethod,
  AthenaRequestOptions,
  AthenaRequestQueryValueMap,
  AthenaRequestResponse,
  AthenaRequestService,
} from "../../client-request.ts";
export type { AthenaResult, AthenaResultError } from "../../result/types.ts";

import { AthenaTransactionError } from "../../db/transaction/errors.ts";
import {
  attachTransactionCompiler,
  nextTransactionOperationId,
} from "../../db/transaction/index.ts";
import type {
  AthenaCacheContextDescriptor,
  AthenaExecutable,
  AthenaExecuteOptions,
  AthenaQueryDescriptor,
  AthenaQueryOperation,
} from "../../query/descriptor.ts";
import {
  compileAthenaQueryDescriptor,
  createCapturedAthenaExecutable,
} from "../../query/descriptor.ts";
import type {
  AthenaFindManyOptions,
  AthenaFindManyResult,
  AthenaSelectShape,
  AthenaValidatedSelectShape,
} from "../../query-ast.ts";
import {
  compileOrderBy,
  compileSelectShape,
  compileWhere,
  selectShapeHasFirstSelection,
  selectShapeHasNestedQueryModifiers,
  selectShapeUsesRelationSchema,
} from "../../query-ast.ts";
import type { AthenaQueryDebugAst } from "../../query-debug-ast.ts";
import {
  buildDeleteDebugAst,
  buildFindManyCompiledDebugAst,
  buildFindManyDirectDebugAst,
  buildInsertDebugAst,
  buildUpdateDebugAst,
  buildUpsertDebugAst,
} from "../../query-debug-ast.ts";
import {
  captureTraceCallsite,
  createTraceCallsiteStore,
  executeWithQueryTrace,
} from "../../query-tracing.ts";
import type { AthenaFindManyAstPayload } from "../../query-transport.ts";
import {
  canUseFindManyAstTransport,
  createSelectTransportPlan,
  findManyAstWhereRequiresLegacyTransport,
  normalizeFindManyAstWhere,
  toFindManyAstOrder,
} from "../../query-transport.ts";
import type {
  AthenaSelectInput,
  AthenaTypecheckedColumnKey,
  AthenaValidatedSelectInput,
  AthenaSelectResult,
} from "../../select-column-types.ts";

export type {
  AthenaColumnKey,
  AthenaColumnKeyWithAutocomplete,
  AthenaResolvedColumnKey,
  AthenaSelectArrayElement,
  AthenaSelectColumnsFor,
  AthenaSelectInput,
  AthenaSelectInputHints,
  AthenaOpaqueSelectRow,
  AthenaProjectedMutationResult,
  AthenaSelectResult,
  AthenaTypecheckedColumnKey,
  AthenaValidatedSelectInput,
  HasKnownSelectColumns,
} from "../../select-column-types.ts";

import type {
  AthenaClientModelForTableName,
  AthenaClientTableName,
  AthenaModelTarget,
  InsertOf,
  RowOf,
  UpdateOf,
} from "../../schema/types.ts";
import type { AthenaQueryExecutionRuntime } from "../../query/execution/operation.ts";
import { executeAthenaSelect } from "../../query/execution/select.ts";
import { createMutationQuery } from "./mutation-query.ts";
import { createFilterMethods } from "./filters.ts";
import {
  collectChangedFields,
  normalizeSelectColumnsInput,
} from "./state.ts";
import type {
  ConditionCastHints,
  TableBuilderState,
} from "./state.ts";
import type {
  AthenaQueryTraceCallsite,
  MutationQuery,
} from "../../query/contracts.ts";
export type { MutationQuery } from "../../query/contracts.ts";
export type AthenaRowShape = Record<string, AthenaJsonValue | undefined>;
type FilterColumnKey<Row> = Extract<keyof NonNullable<Row>, string>;
/** Known keys when the row shape is concrete; `string` when untyped / index signature. */
export type ResolvedFilterColumnKey<Row> = [FilterColumnKey<Row>] extends [never]
  ? string
  : string extends FilterColumnKey<Row>
    ? string
    : FilterColumnKey<Row>;
/**
 * Table-name argument for free-form `from<Row>(table)`.
 * - No client `models` → `string` (nothing to complete).
 * - With `models` → known bare/qualified names (IntelliSense + reject unknowns).
 *   Prefer `.from("users")` without a row generic so the row type is inferred from the model.
 */
export type UntypedTableName<TModels> = [TModels] extends [never]
  ? string
  : [AthenaClientTableName<TModels>] extends [never]
    ? string
    : AthenaClientTableName<TModels>;
type ResolvedClientTableModel<TModels, TTableName extends string> = Extract<
  AthenaClientModelForTableName<TModels, TTableName>,
  AthenaModelTarget
>;
export type ClientTableQueryBuilder<
  TModels,
  TTableName extends string,
> = TableQueryBuilder<
  RowOf<ResolvedClientTableModel<TModels, TTableName>>,
  InsertOf<ResolvedClientTableModel<TModels, TTableName>>,
  UpdateOf<ResolvedClientTableModel<TModels, TTableName>>
>;
/**
 * Select/returning/single column input.
 *
 * - Typed row: validates string lists; arrays use the model-key union.
 * - Untyped row: plain `TValue` (`string | string[]`).
 */
type SelectColumnsFor<
  Row,
  TValue extends AthenaSelectInput,
> = AthenaValidatedSelectInput<Row, TValue>;
const DEFAULT_COLUMNS = "*";

type SelectDebugAstFactory = (input: {
  tableName: string;
  columns: string | string[];
  executionState: TableBuilderState;
  plan: ReturnType<typeof createSelectTransportPlan>;
}) => AthenaQueryDebugAst;

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

function asAthenaJsonObject(value: unknown): AthenaJsonObject {
  return value as unknown as AthenaJsonObject;
}

function asAthenaJsonObjectArray(values: unknown[]): AthenaJsonObject[] {
  return values as unknown as AthenaJsonObject[];
}

export interface OrderOptions {
  ascending?: boolean;
}

/** Shared filter chain - supports eq, limit, etc. in any order relative to select/update */
export interface FilterChain<Self, Row> {
  containedBy: (
    column: ResolvedFilterColumnKey<Row>,
    values: AthenaConditionArrayValue
  ) => Self;
  contains: (
    column: ResolvedFilterColumnKey<Row>,
    values: AthenaConditionArrayValue
  ) => Self;
  currentPage: (value: number) => Self;
  eq: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  eqCast: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue,
    cast: AthenaConditionCastType
  ) => Self;
  eqUuid: (column: ResolvedFilterColumnKey<Row>, value: string) => Self;
  gt: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  gte: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  ilike: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  in: (
    column: ResolvedFilterColumnKey<Row>,
    values: AthenaConditionArrayValue
  ) => Self;
  is: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  like: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  limit: (count: number) => Self;
  lt: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  lte: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  match: (
    filters: Partial<Record<ResolvedFilterColumnKey<Row>, AthenaConditionValue>>
  ) => Self;
  neq: (
    column: ResolvedFilterColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  not: (
    columnOrExpression: ResolvedFilterColumnKey<Row> | string,
    operator?: AthenaConditionOperator,
    value?: AthenaConditionValue
  ) => Self;
  offset: (count: number) => Self;
  or: (expression: string) => Self;
  order: (column: ResolvedFilterColumnKey<Row>, options?: OrderOptions) => Self;
  pageSize: (value: number) => Self;
  range: (from: number, to: number) => Self;
  totalPages: (value: number) => Self;
}

/** Chain returned by select() - supports filters and single/maybeSingle before execution */
export interface SelectChain<Row, SelectedRow = Row>
  extends FilterChain<SelectChain<Row, SelectedRow>, Row>,
    PromiseLike<AthenaResult<SelectedRow[]>>,
    AthenaExecutable<AthenaResult<SelectedRow[]>> {
  maybeSingle: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<
      AthenaSelectResult<SelectedRow, TOverride, TColumns> | null
    >
  >;
  single: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<
      AthenaSelectResult<SelectedRow, TOverride, TColumns> | null
    >
  >;
}

/** Chain returned by update() - supports filters before execution, plus select/returning */
export interface UpdateChain<Row>
  extends FilterChain<UpdateChain<Row>, Row>,
    MutationQuery<Row[], Row> {}

interface RpcFilterChain<Self, Row> {
  eq: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  gt: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  gte: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  ilike: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  in: (
    column: AthenaTypecheckedColumnKey<Row>,
    values: AthenaConditionArrayValue
  ) => Self;
  is: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  like: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  lt: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  lte: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
  neq: (
    column: AthenaTypecheckedColumnKey<Row>,
    value: AthenaConditionValue
  ) => Self;
}

export interface RpcOrderOptions {
  ascending?: boolean;
}

export interface RpcQueryBuilder<Row>
  extends RpcFilterChain<RpcQueryBuilder<Row>, Row>,
    PromiseLike<AthenaResult<Row[]>> {
  limit: (count: number) => RpcQueryBuilder<Row>;
  maybeSingle: <T = Row, const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaResult<T | null>>;
  offset: (count: number) => RpcQueryBuilder<Row>;
  order: (
    column: AthenaTypecheckedColumnKey<Row>,
    options?: RpcOrderOptions
  ) => RpcQueryBuilder<Row>;
  range: (from: number, to: number) => RpcQueryBuilder<Row>;
  select: <const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaResult<Row[]>>;
  single: <T = Row, const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaResult<T | null>>;
}

export interface AthenaFromOptions {
  schema?: string;
}

export interface TableQueryIncludeSpec {
  schema?: string;
  select?: readonly string[];
  targetModel?: string;
}

export type TableQueryIncludeRelations = Record<
  string,
  TableQueryIncludeSpec | true
>;

export interface TableQueryBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  TContext = unknown,
> extends FilterChain<TableQueryBuilder<Row, Insert, Update, TContext>, Row> {
  delete: (
    options?: AthenaGatewayCallOptions & { resourceId?: string }
  ) => MutationQuery<Row | null, Row>;
  findMany: <const TSelect extends AthenaSelectShape>(
    options: AthenaFindManyOptions<Row, TSelect> & {
      select: AthenaValidatedSelectShape<Row, TSelect>;
    }
  ) => Promise<AthenaResult<AthenaFindManyResult<Row, TSelect, TContext>[]>>;
  include: (
    relations: TableQueryIncludeRelations
  ) => TableQueryBuilder<Row, Insert, Update, TContext>;
  insert(
    values: Insert,
    options?: AthenaGatewayCallOptions
  ): MutationQuery<Row, Row>;
  insert(
    values: Insert[],
    options?: AthenaGatewayCallOptions
  ): MutationQuery<Row[], Row>;
  maybeSingle: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<
      AthenaSelectResult<Row, TOverride, TColumns> | null
    >
  >;
  readonly model?: AthenaModelTarget;
  reset: () => TableQueryBuilder<Row, Insert, Update, TContext>;
  select: <TOverride = never, const TColumns extends AthenaSelectInput = string>(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => SelectChain<Row, AthenaSelectResult<Row, TOverride, TColumns>>;
  single: <
    TOverride = never,
    const TColumns extends AthenaSelectInput = string,
  >(
    columns?: SelectColumnsFor<Row, TColumns>,
    options?: AthenaGatewayCallOptions
  ) => Promise<
    AthenaResult<AthenaSelectResult<Row, TOverride, TColumns> | null>
  >;
  update: (
    values: Update,
    options?: AthenaGatewayCallOptions
  ) => UpdateChain<Row>;
  upsert(
    values: Insert,
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update;
      onConflict?:
        | ResolvedFilterColumnKey<Row>
        | ResolvedFilterColumnKey<Row>[]
        | (string & {})
        | Array<string & {}>;
    }
  ): MutationQuery<Row, Row>;
  upsert(
    values: Insert[],
    options?: AthenaGatewayCallOptions & {
      updateBody?: Update;
      onConflict?:
        | ResolvedFilterColumnKey<Row>
        | ResolvedFilterColumnKey<Row>[]
        | (string & {})
        | Array<string & {}>;
    }
  ): MutationQuery<Row[], Row>;
}

function getResourceId(state: TableBuilderState): string | undefined {
  const candidate = state.conditions.find(
    (condition) =>
      condition.operator === "eq" &&
      (condition.column === "resource_id" || condition.column === "id")
  );
  return candidate?.value?.toString();
}

export function createTableBuilder<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Insert>,
  TContext = unknown,
>(
  tableName: string,
  runtime: AthenaQueryExecutionRuntime,
  builderOptions?: {
    cacheContext?: AthenaCacheContextDescriptor;
    model?: AthenaModelTarget;
  }
): TableQueryBuilder<Row, Insert, Update, TContext> {
  const {
    behavior,
    formatGatewayResult,
    gateway: client,
    tracer,
  } = runtime;
  const state: TableBuilderState = {
    cacheContext: builderOptions?.cacheContext,
    conditions: [],
    model: builderOptions?.model,
  };
  const debugAstEnabled = Boolean(behavior?.debugAst);

  const addCondition = (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
    hints?: ConditionCastHints
  ) => {
    const condition: AthenaGatewayCondition = { operator };
    if (column) {
      condition.column = column;
      if (operator === "eq") {
        // include legacy gateway shape for compatibility
        condition.eq_column = column;
      }
    }
    if (value !== undefined) {
      condition.value = value;
      if (operator === "eq") {
        condition.eq_value = value;
      }
    }
    if (hints?.valueCast) {
      condition.value_cast = hints.valueCast;
      if (operator === "eq") {
        condition.eq_value_cast = hints.valueCast;
      }
    }
    if (hints?.columnCast) {
      condition.column_cast = hints.columnCast;
      if (operator === "eq") {
        condition.eq_column_cast = hints.columnCast;
      }
    }
    state.conditions.push(condition);
  };

  const snapshotState = (): TableBuilderState => ({
    cacheContext: state.cacheContext,
    conditions: state.conditions.map((condition) => ({ ...condition })),
    currentPage: state.currentPage,
    limit: state.limit,
    model: state.model,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
    pageSize: state.pageSize,
    relations: state.relations ? [...state.relations] : undefined,
    totalPages: state.totalPages,
  });

  const compileDescriptor = (
    operation: AthenaQueryOperation,
    projection?: AthenaSelectInput | null,
    changedFields?: readonly string[]
  ): AthenaQueryDescriptor =>
    compileAthenaQueryDescriptor({
      changedFields,
      conditions: state.conditions,
      context: state.cacheContext,
      currentPage: state.currentPage,
      limit: state.limit,
      model: state.model,
      offset: state.offset,
      operation,
      order: state.order,
      pageSize: state.pageSize,
      projection:
        projection === null
          ? null
          : (normalizeSelectColumnsInput(projection) ?? "*"),
      relations: state.relations,
      tableName,
    });

  const mutationExecutable = (
    operation: AthenaQueryOperation,
    changedFields?: readonly string[]
  ) => ({
    getDescriptor: (projection: AthenaSelectInput | undefined) =>
      compileDescriptor(operation, projection ?? null, changedFields),
    model: state.model,
  });

  const builder = {} as TableQueryBuilder<Row, Insert, Update, TContext>;

  const filterMethods = createFilterMethods<
    TableQueryBuilder<Row, Insert, Update, TContext>,
    Row
  >(state, addCondition, builder);

  const runSelect = async <T = Row>(
    columns: AthenaSelectInput = DEFAULT_COLUMNS,
    options?: AthenaGatewayCallOptions,
    executionState: TableBuilderState = snapshotState(),
    callsite?: AthenaQueryTraceCallsite | null,
    debugAstFactory?: SelectDebugAstFactory
  ) => {
    const runtimeColumns =
      normalizeSelectColumnsInput(columns) ?? DEFAULT_COLUMNS;
    return executeAthenaSelect<T>({
      columns: runtimeColumns,
      debugAstFactory,
      options,
      runtime,
      state: executionState,
      tableName,
      callsite,
    });
  };

  const createSelectChain = <SelectedRow>(
    columns: AthenaSelectInput,
    options?: AthenaGatewayCallOptions,
    initialCallsite?: AthenaQueryTraceCallsite | null
  ): SelectChain<Row, SelectedRow> => {
    const chain = {} as SelectChain<Row, SelectedRow>;
    const callsiteStore = createTraceCallsiteStore(tracer, initialCallsite);
    const filterMethods = createFilterMethods<
      SelectChain<Row, SelectedRow>,
      Row
    >(state, addCondition, chain);
    Object.assign(chain, filterMethods, {
      capture() {
        const frozenState = snapshotState();
        return createCapturedAthenaExecutable({
          descriptor: compileDescriptor("select", columns),
          execute: (executeOptions) =>
            runSelect<SelectedRow[]>(
              columns,
              {
                ...options,
                signal: executeOptions?.signal ?? options?.signal,
              },
              frozenState,
              callsiteStore.resolve()
            ),
          model: state.model,
        });
      },
      catch<T = never>(onrejected?: (reason: unknown) => T | PromiseLike<T>) {
        return runSelect<SelectedRow[]>(
          columns,
          options,
          snapshotState(),
          callsiteStore.resolve()
        ).catch(onrejected);
      },
      execute(executeOptions?: AthenaExecuteOptions) {
        return runSelect<SelectedRow[]>(
          columns,
          {
            ...options,
            signal: executeOptions?.signal ?? options?.signal,
          },
          snapshotState(),
          callsiteStore.resolve()
        );
      },
      finally(onfinally?: () => void) {
        return runSelect<SelectedRow[]>(
          columns,
          options,
          snapshotState(),
          callsiteStore.resolve()
        ).finally(onfinally);
      },
      getDescriptor() {
        return compileDescriptor("select", columns);
      },
      maybeSingle<T = SelectedRow>(
        cols?: AthenaSelectInput,
        opts?: AthenaGatewayCallOptions
      ) {
        return runSelect<T[]>(
          cols ?? columns,
          opts ?? options,
          snapshotState(),
          callsiteStore.resolve(captureTraceCallsite(tracer))
        ).then((r) => applyCardinality(r, "maybeSingle"));
      },
      model: state.model,
      async single<T = SelectedRow>(
        cols?: AthenaSelectInput,
        opts?: AthenaGatewayCallOptions
      ) {
        const r = await runSelect<T[]>(
          cols ?? columns,
          opts ?? options,
          snapshotState(),
          callsiteStore.resolve(captureTraceCallsite(tracer))
        );
        return applyCardinality(r, "single");
      },
      // Thenable so `await query` resolves the deferred run without an extra API.
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable query builder
      then<T1 = AthenaResult<SelectedRow[]>, T2 = never>(
        onfulfilled?: (v: AthenaResult<SelectedRow[]>) => T1 | PromiseLike<T1>,
        onrejected?: (reason: unknown) => T2 | PromiseLike<T2>
      ) {
        return runSelect<SelectedRow[]>(
          columns,
          options,
          snapshotState(),
          callsiteStore.resolve()
        ).then(onfulfilled, onrejected);
      },
    });
    attachTransactionCompiler(chain, () => {
      const executionState = snapshotState();
      const runtimeColumns =
        normalizeSelectColumnsInput(columns) ?? DEFAULT_COLUMNS;
      const resolvedTableName = resolveTableNameForCall(
        tableName,
        options?.schema
      );
      const plan = createSelectTransportPlan({
        buildTypedSelectQuery,
        columns: runtimeColumns,
        options,
        state: executionState,
        tableName: resolvedTableName,
      });
      if (plan.kind !== "fetch") {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
          "This select cannot be compiled into a portable transaction fetch (raw SQL fallback is not transaction IR)",
          { table: resolvedTableName }
        );
      }
      return {
        descriptor: compileDescriptor("select", columns),
        id: nextTransactionOperationId(),
        index: 0,
        kind: "fetch",
        payload: plan.payload,
      };
    });
    return chain;
  };

  Object.assign(builder, filterMethods, {
    delete(options?: AthenaGatewayCallOptions & { resourceId?: string }) {
      const filters = state.conditions.length
        ? [...state.conditions]
        : undefined;
      const resourceId = options?.resourceId ?? getResourceId(state);
      if (!(resourceId || filters?.length)) {
        throw new Error(
          'delete requires a resource_id either via eq("resource_id", ...) or options.resourceId'
        );
      }
      const mutationCallsite = captureTraceCallsite(tracer);
      const executeDelete = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null
      ) => {
        const executionState = snapshotState();
        const debugState: TableBuilderState = {
          ...executionState,
          conditions: filters
            ? filters.map((condition) => ({ ...condition }))
            : [],
        };
        const mergedOptions = mergeOptions(options, selectOptions);
        const resolvedTableName = resolveTableNameForCall(
          tableName,
          mergedOptions?.schema
        );
        const payload: AthenaDeletePayload = {
          conditions: filters,
          resource_id: resourceId,
          table_name: resolvedTableName,
        };
        if (executionState.order) {
          payload.sort_by = executionState.order;
        }
        if (executionState.limit !== undefined) {
          payload.limit = executionState.limit;
        }
        if (executionState.offset !== undefined) {
          payload.offset = executionState.offset;
        }
        if (executionState.currentPage !== undefined) {
          payload.current_page = executionState.currentPage;
        }
        if (executionState.pageSize !== undefined) {
          payload.page_size = executionState.pageSize;
        }
        if (executionState.totalPages !== undefined) {
          payload.total_pages = executionState.totalPages;
        }
        if (columns) {
          payload.columns = columns;
        }
        const sql = buildDeleteDebugSql(payload);
        const debugAst = debugAstEnabled
          ? buildDeleteDebugAst({
              payload,
              state: debugState,
            })
          : undefined;
        return executeWithQueryTrace(
          tracer,
          {
            ast: debugAst,
            endpoint: "/gateway/delete",
            operation: "delete",
            options: mergedOptions,
            payload,
            sql,
            table: resolvedTableName,
          },
          async () => {
            const response = await client.deleteGateway<Row | null>(
              payload,
              mergedOptions
            );
            return formatGatewayResult(response, {
              operation: "delete",
              table: resolvedTableName,
            });
          },
          callsite
        );
      };
      return createMutationQuery<Row | null>(
        executeDelete,
        null,
        tracer,
        mutationCallsite,
        mutationExecutable("delete"),
        (columns, selectOptions) => {
          const executionState = snapshotState();
          const filters = executionState.conditions.length
            ? [...executionState.conditions]
            : undefined;
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaDeletePayload = {
            conditions: filters,
            resource_id: resourceId,
            table_name: resolvedTableName,
          };
          if (executionState.order) {
            payload.sort_by = executionState.order;
          }
          if (executionState.limit !== undefined) {
            payload.limit = executionState.limit;
          }
          if (executionState.offset !== undefined) {
            payload.offset = executionState.offset;
          }
          if (executionState.currentPage !== undefined) {
            payload.current_page = executionState.currentPage;
          }
          if (executionState.pageSize !== undefined) {
            payload.page_size = executionState.pageSize;
          }
          if (executionState.totalPages !== undefined) {
            payload.total_pages = executionState.totalPages;
          }
          if (columns) {
            payload.columns = columns;
          }
          return { kind: "delete", payload };
        }
      );
    },
    async findMany<const TSelect extends AthenaSelectShape>(
      options: AthenaFindManyOptions<Row, TSelect> & {
        select: AthenaValidatedSelectShape<Row, TSelect>;
      }
    ) {
      const baseState = snapshotState();
      const executionState = snapshotState();
      const callsite = captureTraceCallsite(tracer);
      if (options.orderBy !== undefined) {
        executionState.order = compileOrderBy<Row>(options.orderBy);
      }
      if (options.limit !== undefined) {
        executionState.limit = options.limit;
      }
      const nestedQueryModifiers = selectShapeHasNestedQueryModifiers(
        options.select
      );
      const schemaQualifiedRelation = selectShapeUsesRelationSchema(
        options.select
      );
      const useFindManyAst =
        Boolean(behavior?.findManyAst) &&
        canUseFindManyAstTransport(baseState) &&
        !findManyAstWhereRequiresLegacyTransport(options.where) &&
        (!schemaQualifiedRelation ||
          Boolean(behavior?.findManyAstRelationSchema));
      const columns =
        useFindManyAst && selectShapeHasFirstSelection(options.select)
          ? "*"
          : compileSelectShape(options.select);
      if (!useFindManyAst) {
        const compiledWhere = compileWhere(options.where);
        if (compiledWhere?.length) {
          executionState.conditions.push(...compiledWhere);
        }
      }
      if (!useFindManyAst && nestedQueryModifiers) {
        throw new Error(
          "ATHENA_QUERY_UNSUPPORTED_CAPABILITY: nested relation where/order/limit require the findMany AST path"
        );
      }
      if (useFindManyAst) {
        const resolvedTableName = resolveTableNameForCall(tableName, undefined);
        const payload: AthenaFindManyAstPayload<Row, TSelect> = {
          select: options.select,
          table_name: resolvedTableName,
        };
        if (options.where !== undefined) {
          payload.where = normalizeFindManyAstWhere(options.where);
        }
        const astOrder = toFindManyAstOrder<Row>(executionState.order);
        if (astOrder !== undefined) {
          payload.orderBy = astOrder;
        }
        if (executionState.limit !== undefined) {
          payload.limit = executionState.limit;
        }
        const sql = buildDebugSelectQuery({
          columns,
          conditions: executionState.conditions,
          limit: executionState.limit,
          order: executionState.order,
          tableName: resolvedTableName,
        });
        const debugAst = debugAstEnabled
          ? buildFindManyDirectDebugAst({
              baseState,
              compiledColumns: columns,
              executionState,
              options,
              payload,
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
              payload,
              sql,
              table: resolvedTableName,
            },
            async () => {
              const response =
                await client.fetchGateway<
                  AthenaFindManyResult<Row, TSelect, TContext>[]
                >(payload);
              return formatGatewayResult(response, {
                operation: "select",
                table: resolvedTableName,
              });
            },
            callsite
          )
        );
      }
      return runSelect<AthenaFindManyResult<Row, TSelect, TContext>[]>(
        columns,
        undefined,
        executionState,
        callsite,
        debugAstEnabled
          ? ({
              tableName: resolvedTableName,
              executionState: tracedState,
              plan,
            }) =>
              buildFindManyCompiledDebugAst({
                baseState,
                compiledColumns: columns,
                executionState: tracedState,
                options,
                plan,
                tableName: resolvedTableName,
              })
          : undefined
      );
    },
    include(relations: TableQueryIncludeRelations) {
      const meta = state.model?.meta.relations;
      state.relations = Object.keys(relations)
        .sort((left, right) => left.localeCompare(right))
        .map((name) => {
          const spec = relations[name];
          const relMeta = meta?.[name];
          const selected = spec === true ? undefined : spec?.select;
          return {
            columns: selected,
            name,
            sourceColumns: relMeta?.sourceColumns,
            star: spec === true || !selected?.length,
            targetColumns: relMeta?.targetColumns,
            targetModel:
              spec === true
                ? relMeta?.targetModel
                : (spec?.targetModel ?? relMeta?.targetModel),
            targetSchema:
              spec === true
                ? relMeta?.targetSchema
                : (spec?.schema ?? relMeta?.targetSchema),
            via: relMeta?.targetModel,
          };
        });
      return builder;
    },
    insert(values: Insert | Insert[], options?: AthenaGatewayCallOptions) {
      const insertChangedFields = collectChangedFields(values);
      const mutationCallsite = captureTraceCallsite(tracer);
      if (Array.isArray(values)) {
        const executeInsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
          callsite?: AthenaQueryTraceCallsite | null
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaInsertPayload = {
            insert_body: asAthenaJsonObjectArray(values),
            table_name: resolvedTableName,
          };
          if (columns) {
            payload.columns = columns;
          }
          if (mergedOptions?.count) {
            payload.count = mergedOptions.count;
          }
          if (mergedOptions?.head) {
            payload.head = mergedOptions.head;
          }
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull;
          }
          const sql = buildInsertDebugSql(payload);
          const debugAst = debugAstEnabled
            ? buildInsertDebugAst(payload)
            : undefined;
          return executeWithQueryTrace(
            tracer,
            {
              ast: debugAst,
              endpoint: "/gateway/insert",
              operation: "insert",
              options: mergedOptions,
              payload,
              sql,
              table: resolvedTableName,
            },
            async () => {
              const response = await client.insertGateway<Row[]>(
                payload,
                mergedOptions
              );
              return formatGatewayResult(response, {
                operation: "insert",
                table: resolvedTableName,
              });
            },
            callsite
          );
        };
        return createMutationQuery<Row[]>(
          executeInsertMany,
          DEFAULT_COLUMNS,
          tracer,
          mutationCallsite,
          mutationExecutable("insert", insertChangedFields),
          (columns, selectOptions) => {
            const mergedOptions = mergeOptions(options, selectOptions);
            const resolvedTableName = resolveTableNameForCall(
              tableName,
              mergedOptions?.schema
            );
            const payload: AthenaInsertPayload = {
              insert_body: asAthenaJsonObjectArray(values),
              table_name: resolvedTableName,
            };
            const payloadColumns = normalizeSelectColumnsInput(columns);
            if (payloadColumns) {
              payload.columns = payloadColumns;
            }
            if (mergedOptions?.count) {
              payload.count = mergedOptions.count;
            }
            if (mergedOptions?.head) {
              payload.head = mergedOptions.head;
            }
            if (mergedOptions?.defaultToNull !== undefined) {
              payload.default_to_null = mergedOptions.defaultToNull;
            }
            return { kind: "insert", payload };
          }
        );
      }
      const executeInsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions);
        const resolvedTableName = resolveTableNameForCall(
          tableName,
          mergedOptions?.schema
        );
        const payload: AthenaInsertPayload = {
          insert_body: asAthenaJsonObject(values),
          table_name: resolvedTableName,
        };
        if (columns) {
          payload.columns = columns;
        }
        if (mergedOptions?.count) {
          payload.count = mergedOptions.count;
        }
        if (mergedOptions?.head) {
          payload.head = mergedOptions.head;
        }
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull;
        }
        const sql = buildInsertDebugSql(payload);
        const debugAst = debugAstEnabled
          ? buildInsertDebugAst(payload)
          : undefined;
        return executeWithQueryTrace(
          tracer,
          {
            ast: debugAst,
            endpoint: "/gateway/insert",
            operation: "insert",
            options: mergedOptions,
            payload,
            sql,
            table: resolvedTableName,
          },
          async () => {
            const response = await client.insertGateway<Row>(
              payload,
              mergedOptions
            );
            return formatGatewayResult(response, {
              operation: "insert",
              table: resolvedTableName,
            });
          },
          callsite
        );
      };
      return createMutationQuery<Row>(
        executeInsertOne,
        DEFAULT_COLUMNS,
        tracer,
        mutationCallsite,
        mutationExecutable("insert", insertChangedFields),
        (columns, selectOptions) => {
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaInsertPayload = {
            insert_body: asAthenaJsonObject(values),
            table_name: resolvedTableName,
          };
          if (columns) {
            payload.columns = columns;
          }
          if (mergedOptions?.count) {
            payload.count = mergedOptions.count;
          }
          if (mergedOptions?.head) {
            payload.head = mergedOptions.head;
          }
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull;
          }
          return { kind: "insert", payload };
        }
      );
    },
    async maybeSingle<T = Row>(
      columns?: AthenaSelectInput,
      options?: AthenaGatewayCallOptions
    ) {
      const response = await runSelect<T[]>(
        columns ?? DEFAULT_COLUMNS,
        options,
        snapshotState(),
        captureTraceCallsite(tracer)
      );
      return applyCardinality(response, "maybeSingle");
    },
    model: state.model,
    reset() {
      state.conditions = [];
      state.limit = undefined;
      state.offset = undefined;
      state.order = undefined;
      state.currentPage = undefined;
      state.pageSize = undefined;
      state.totalPages = undefined;
      return builder;
    },
    select<T = Row>(
      columns: AthenaSelectInput = DEFAULT_COLUMNS,
      options?: AthenaGatewayCallOptions
    ) {
      return createSelectChain<T>(
        columns,
        options,
        captureTraceCallsite(tracer)
      );
    },
    async single<T = Row>(
      columns?: AthenaSelectInput,
      options?: AthenaGatewayCallOptions
    ) {
      const response = await runSelect<T[]>(
        columns ?? DEFAULT_COLUMNS,
        options,
        snapshotState(),
        captureTraceCallsite(tracer)
      );
      return applyCardinality(response, "single");
    },
    update(values: Update, options?: AthenaGatewayCallOptions) {
      const updateChangedFields = collectChangedFields(values);
      const mutationCallsite = captureTraceCallsite(tracer);
      const executeUpdate = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null
      ) => {
        const executionState = snapshotState();
        const filters = executionState.conditions.length
          ? [...executionState.conditions]
          : undefined;
        const mergedOptions = mergeOptions(options, selectOptions);
        const resolvedTableName = resolveTableNameForCall(
          tableName,
          mergedOptions?.schema
        );
        const payload: AthenaUpdatePayload = {
          conditions: filters,
          strip_nulls: mergedOptions?.stripNulls ?? true,
          table_name: resolvedTableName,
          update_body: asAthenaJsonObject(values),
        };
        if (executionState.order) {
          payload.sort_by = executionState.order;
        }
        if (executionState.limit !== undefined) {
          payload.limit = executionState.limit;
        }
        if (executionState.offset !== undefined) {
          payload.offset = executionState.offset;
        }
        if (executionState.currentPage !== undefined) {
          payload.current_page = executionState.currentPage;
        }
        if (executionState.pageSize !== undefined) {
          payload.page_size = executionState.pageSize;
        }
        if (executionState.totalPages !== undefined) {
          payload.total_pages = executionState.totalPages;
        }
        if (columns) {
          payload.columns = columns;
        }
        const sql = buildUpdateDebugSql(payload);
        const debugAst = debugAstEnabled
          ? buildUpdateDebugAst({
              payload,
              state: executionState,
            })
          : undefined;
        return executeWithQueryTrace(
          tracer,
          {
            ast: debugAst,
            endpoint: "/gateway/update",
            operation: "update",
            options: mergedOptions,
            payload,
            sql,
            table: resolvedTableName,
          },
          async () => {
            const response = await client.updateGateway<Row[]>(
              payload,
              mergedOptions
            );
            return formatGatewayResult(response, {
              operation: "update",
              table: resolvedTableName,
            });
          },
          callsite
        );
      };
      const mutation = createMutationQuery<Row[]>(
        executeUpdate,
        null,
        tracer,
        mutationCallsite,
        mutationExecutable("update", updateChangedFields),
        (columns, selectOptions) => {
          const executionState = snapshotState();
          const filters = executionState.conditions.length
            ? [...executionState.conditions]
            : undefined;
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaUpdatePayload = {
            conditions: filters,
            strip_nulls: mergedOptions?.stripNulls ?? true,
            table_name: resolvedTableName,
            update_body: asAthenaJsonObject(values),
          };
          if (executionState.order) {
            payload.sort_by = executionState.order;
          }
          if (executionState.limit !== undefined) {
            payload.limit = executionState.limit;
          }
          if (executionState.offset !== undefined) {
            payload.offset = executionState.offset;
          }
          if (executionState.currentPage !== undefined) {
            payload.current_page = executionState.currentPage;
          }
          if (executionState.pageSize !== undefined) {
            payload.page_size = executionState.pageSize;
          }
          if (executionState.totalPages !== undefined) {
            payload.total_pages = executionState.totalPages;
          }
          if (columns) {
            payload.columns = columns;
          }
          return { kind: "update", payload };
        }
      );
      const updateChain = {} as UpdateChain<Row>;
      const filterMethods = createFilterMethods<UpdateChain<Row>, Row>(
        state,
        addCondition,
        updateChain
      );
      Object.assign(updateChain, filterMethods, mutation);
      return updateChain;
    },
    upsert(
      values: Insert | Insert[],
      options?: AthenaGatewayCallOptions & {
        updateBody?: Update;
        onConflict?: string | string[];
      }
    ) {
      const upsertChangedFields = collectChangedFields(values);
      const mutationCallsite = captureTraceCallsite(tracer);
      if (Array.isArray(values)) {
        const executeUpsertMany = async (
          columns?: string | string[],
          selectOptions?: AthenaGatewayCallOptions,
          callsite?: AthenaQueryTraceCallsite | null
        ) => {
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaInsertPayload = {
            insert_body: asAthenaJsonObjectArray(values),
            table_name: resolvedTableName,
            update_body: options?.updateBody
              ? asAthenaJsonObject(options.updateBody)
              : undefined,
          };
          if (columns) {
            payload.columns = columns;
          }
          if (options?.onConflict) {
            payload.on_conflict = options.onConflict;
          }
          if (mergedOptions?.count) {
            payload.count = mergedOptions.count;
          }
          if (mergedOptions?.head) {
            payload.head = mergedOptions.head;
          }
          if (mergedOptions?.defaultToNull !== undefined) {
            payload.default_to_null = mergedOptions.defaultToNull;
          }
          const sql = buildInsertDebugSql(payload);
          const debugAst = debugAstEnabled
            ? buildUpsertDebugAst(payload)
            : undefined;
          return executeWithQueryTrace(
            tracer,
            {
              ast: debugAst,
              endpoint: "/gateway/insert",
              operation: "upsert",
              options: mergedOptions,
              payload,
              semanticOperation: "upsert",
              sql,
              table: resolvedTableName,
            },
            async () => {
              const response = await client.insertGateway<Row[]>(
                payload,
                mergedOptions
              );
              return formatGatewayResult(response, {
                operation: "insert",
                table: resolvedTableName,
              });
            },
            callsite
          );
        };
        return createMutationQuery<Row[]>(
          executeUpsertMany,
          DEFAULT_COLUMNS,
          tracer,
          mutationCallsite,
          mutationExecutable("upsert", upsertChangedFields),
          (columns, selectOptions) => {
            const mergedOptions = mergeOptions(options, selectOptions);
            const resolvedTableName = resolveTableNameForCall(
              tableName,
              mergedOptions?.schema
            );
            const payload: AthenaInsertPayload = {
              insert_body: asAthenaJsonObjectArray(values as Insert[]),
              table_name: resolvedTableName,
              update_body: options?.updateBody
                ? asAthenaJsonObject(options.updateBody)
                : undefined,
            };
            const payloadColumns = normalizeSelectColumnsInput(columns);
            if (payloadColumns) {
              payload.columns = payloadColumns;
            }
            if (options?.onConflict) {
              payload.on_conflict = options.onConflict;
            }
            return { kind: "insert", payload };
          }
        );
      }
      const executeUpsertOne = async (
        columns?: string | string[],
        selectOptions?: AthenaGatewayCallOptions,
        callsite?: AthenaQueryTraceCallsite | null
      ) => {
        const mergedOptions = mergeOptions(options, selectOptions);
        const resolvedTableName = resolveTableNameForCall(
          tableName,
          mergedOptions?.schema
        );
        const payload: AthenaInsertPayload = {
          insert_body: asAthenaJsonObject(values),
          table_name: resolvedTableName,
          update_body: options?.updateBody
            ? asAthenaJsonObject(options.updateBody)
            : undefined,
        };
        if (columns) {
          payload.columns = columns;
        }
        if (options?.onConflict) {
          payload.on_conflict = options.onConflict;
        }
        if (mergedOptions?.count) {
          payload.count = mergedOptions.count;
        }
        if (mergedOptions?.head) {
          payload.head = mergedOptions.head;
        }
        if (mergedOptions?.defaultToNull !== undefined) {
          payload.default_to_null = mergedOptions.defaultToNull;
        }
        const sql = buildInsertDebugSql(payload);
        const debugAst = debugAstEnabled
          ? buildUpsertDebugAst(payload)
          : undefined;
        return executeWithQueryTrace(
          tracer,
          {
            ast: debugAst,
            endpoint: "/gateway/insert",
            operation: "upsert",
            options: mergedOptions,
            payload,
            semanticOperation: "upsert",
            sql,
            table: resolvedTableName,
          },
          async () => {
            const response = await client.insertGateway<Row>(
              payload,
              mergedOptions
            );
            return formatGatewayResult(response, {
              operation: "insert",
              table: resolvedTableName,
            });
          },
          callsite
        );
      };
      return createMutationQuery<Row>(
        executeUpsertOne,
        DEFAULT_COLUMNS,
        tracer,
        mutationCallsite,
        mutationExecutable("upsert", upsertChangedFields),
        (columns, selectOptions) => {
          const mergedOptions = mergeOptions(options, selectOptions);
          const resolvedTableName = resolveTableNameForCall(
            tableName,
            mergedOptions?.schema
          );
          const payload: AthenaInsertPayload = {
            insert_body: asAthenaJsonObject(values),
            table_name: resolvedTableName,
            update_body: options?.updateBody
              ? asAthenaJsonObject(options.updateBody)
              : undefined,
          };
          if (columns) {
            payload.columns = columns;
          }
          if (options?.onConflict) {
            payload.on_conflict = options.onConflict;
          }
          return { kind: "insert", payload };
        }
      );
    },
  });

  return builder;
}
