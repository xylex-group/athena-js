import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaJsonObject,
  AthenaRpcFilter,
  AthenaRpcPayload,
  AthenaSortBy,
  AthenaUpdatePayload,
} from "./gateway/types.ts";
import type {
  AthenaFindManyOptions,
  AthenaOrderBy,
  AthenaSelectShape,
  AthenaWhere,
} from "./query-ast.ts";
import type {
  AthenaFindManyAstPayload,
  AthenaSelectTransportPlan,
} from "./query-transport.ts";

const ATHENA_DEBUG_AST_KEY = "__athenaDebugAst" as const;

export interface AthenaTableBuilderStateAst {
  conditions: AthenaGatewayCondition[];
  currentPage?: number;
  limit?: number;
  offset?: number;
  order?: AthenaSortBy;
  pageSize?: number;
  totalPages?: number;
}

export interface AthenaRpcBuilderStateAst {
  filters: AthenaRpcFilter[];
  limit?: number;
  offset?: number;
  order?: {
    column: string;
    ascending?: boolean;
  };
}

export type AthenaDebugQueryEndpoint =
  | "/gateway/fetch"
  | "/gateway/insert"
  | "/gateway/update"
  | "/gateway/delete"
  | "/gateway/rpc"
  | "/gateway/query"
  | `/rpc/${string}`;

interface AthenaDebugAstBase<TKind extends string> {
  kind: TKind;
  version: 1;
}

export type AthenaSelectDebugTransport =
  | {
      mode: "compiled-fetch" | "structured-fetch";
      endpoint: "/gateway/fetch";
      payload: AthenaFetchPayload;
    }
  | {
      mode: "typed-query";
      endpoint: "/gateway/query";
      payload: {
        query: string;
      };
    };

export interface AthenaSelectDebugAst extends AthenaDebugAstBase<"select"> {
  input: {
    columns: string | string[];
    state: AthenaTableBuilderStateAst;
  };
  tableName: string;
  transport: AthenaSelectDebugTransport;
}

export type AthenaFindManyDebugTransport<
  Row = Record<string, unknown>,
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> =
  | {
      mode: "direct-ast-fetch";
      endpoint: "/gateway/fetch";
      payload: AthenaFindManyAstPayload<Row, TSelect>;
    }
  | {
      mode: "compiled-fetch" | "structured-fetch";
      endpoint: "/gateway/fetch";
      payload: AthenaFetchPayload;
    }
  | {
      mode: "compiled-query";
      endpoint: "/gateway/query";
      payload: {
        query: string;
      };
    };

export interface AthenaFindManyDebugAst<
  Row = Record<string, unknown>,
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> extends AthenaDebugAstBase<"findMany"> {
  compiled: {
    columns: string;
    baseState: AthenaTableBuilderStateAst;
    executionState: AthenaTableBuilderStateAst;
  };
  input: {
    select: TSelect;
    where?: AthenaWhere<Row>;
    orderBy?: AthenaOrderBy<Row>;
    limit?: number;
  };
  tableName: string;
  transport: AthenaFindManyDebugTransport<Row, TSelect>;
}

export interface AthenaInsertDebugAst extends AthenaDebugAstBase<"insert"> {
  input: {
    values: AthenaInsertPayload["insert_body"];
    returning?: AthenaInsertPayload["columns"];
    count?: AthenaInsertPayload["count"];
    head?: boolean;
    defaultToNull?: boolean;
  };
  tableName: string;
  transport: {
    mode: "insert";
    endpoint: "/gateway/insert";
    payload: AthenaInsertPayload;
  };
}

export interface AthenaUpsertDebugAst extends AthenaDebugAstBase<"upsert"> {
  input: {
    values: AthenaInsertPayload["insert_body"];
    updateBody?: AthenaInsertPayload["update_body"];
    onConflict?: AthenaInsertPayload["on_conflict"];
    returning?: AthenaInsertPayload["columns"];
    count?: AthenaInsertPayload["count"];
    head?: boolean;
    defaultToNull?: boolean;
  };
  tableName: string;
  transport: {
    mode: "upsert";
    endpoint: "/gateway/insert";
    payload: AthenaInsertPayload;
  };
}

export interface AthenaUpdateDebugAst extends AthenaDebugAstBase<"update"> {
  input: {
    values: AthenaUpdatePayload["update_body"];
    state: AthenaTableBuilderStateAst;
    returning?: AthenaUpdatePayload["columns"];
  };
  tableName: string;
  transport: {
    mode: "update";
    endpoint: "/gateway/update";
    payload: AthenaUpdatePayload;
  };
}

export interface AthenaDeleteDebugAst extends AthenaDebugAstBase<"delete"> {
  input: {
    resourceId?: AthenaDeletePayload["resource_id"];
    state: AthenaTableBuilderStateAst;
    returning?: AthenaDeletePayload["columns"];
  };
  tableName: string;
  transport: {
    mode: "delete";
    endpoint: "/gateway/delete";
    payload: AthenaDeletePayload;
  };
}

export interface AthenaRpcDebugAst extends AthenaDebugAstBase<"rpc"> {
  functionName: string;
  input: {
    args?: AthenaJsonObject;
    select?: string | string[];
    state: AthenaRpcBuilderStateAst;
  };
  transport: {
    mode: "rpc-post" | "rpc-get";
    endpoint: "/gateway/rpc" | `/rpc/${string}`;
    payload: AthenaRpcPayload;
  };
}

export interface AthenaRawQueryDebugAst extends AthenaDebugAstBase<"query"> {
  input: {
    query: string;
  };
  transport: {
    mode: "raw-query";
    endpoint: "/gateway/query";
    payload: {
      query: string;
    };
  };
}

export type AthenaQueryDebugAst =
  | AthenaSelectDebugAst
  | AthenaFindManyDebugAst
  | AthenaInsertDebugAst
  | AthenaUpsertDebugAst
  | AthenaUpdateDebugAst
  | AthenaDeleteDebugAst
  | AthenaRpcDebugAst
  | AthenaRawQueryDebugAst;

function cloneConditions(
  conditions: AthenaGatewayCondition[]
): AthenaGatewayCondition[] {
  return conditions.map((condition) => ({ ...condition }));
}

export function cloneTableBuilderStateAst(
  state: AthenaTableBuilderStateAst
): AthenaTableBuilderStateAst {
  return {
    conditions: cloneConditions(state.conditions),
    currentPage: state.currentPage,
    limit: state.limit,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
    pageSize: state.pageSize,
    totalPages: state.totalPages,
  };
}

export function cloneRpcBuilderStateAst(
  state: AthenaRpcBuilderStateAst
): AthenaRpcBuilderStateAst {
  return {
    filters: state.filters.map((filter) => ({ ...filter })),
    limit: state.limit,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
  };
}

function toSelectTransportAst(
  plan: AthenaSelectTransportPlan
): AthenaSelectDebugTransport {
  if (plan.kind === "query") {
    return {
      endpoint: "/gateway/query",
      mode: "typed-query",
      payload: plan.payload,
    };
  }

  return {
    endpoint: "/gateway/fetch",
    mode:
      plan.payload.select === undefined ? "compiled-fetch" : "structured-fetch",
    payload: plan.payload,
  };
}

function resolveDebugTableName(tableName: string | undefined): string {
  return tableName ?? "__unknown_table__";
}

export function buildSelectDebugAst(input: {
  tableName: string;
  columns: string | string[];
  state: AthenaTableBuilderStateAst;
  plan: AthenaSelectTransportPlan;
}): AthenaSelectDebugAst {
  return {
    input: {
      columns: input.columns,
      state: cloneTableBuilderStateAst(input.state),
    },
    kind: "select",
    tableName: input.tableName,
    transport: toSelectTransportAst(input.plan),
    version: 1,
  };
}

export function buildFindManyCompiledDebugAst<
  Row,
  TSelect extends AthenaSelectShape,
>(input: {
  tableName: string;
  /** Already validated at the public `findMany` callsite. */
  options: AthenaFindManyOptions<Row, TSelect>;
  compiledColumns: string;
  baseState: AthenaTableBuilderStateAst;
  executionState: AthenaTableBuilderStateAst;
  plan: AthenaSelectTransportPlan;
}): AthenaFindManyDebugAst<Row, TSelect> {
  return {
    compiled: {
      baseState: cloneTableBuilderStateAst(input.baseState),
      columns: input.compiledColumns,
      executionState: cloneTableBuilderStateAst(input.executionState),
    },
    input: {
      limit: input.options.limit,
      orderBy: input.options.orderBy,
      select: input.options.select,
      where: input.options.where,
    },
    kind: "findMany",
    tableName: input.tableName,
    transport: planToFindManyTransport<Row, TSelect>(input.plan),
    version: 1,
  };
}

export function buildFindManyDirectDebugAst<
  Row,
  TSelect extends AthenaSelectShape,
>(input: {
  tableName: string;
  /** Already validated at the public `findMany` callsite. */
  options: AthenaFindManyOptions<Row, TSelect>;
  compiledColumns: string;
  baseState: AthenaTableBuilderStateAst;
  executionState: AthenaTableBuilderStateAst;
  payload: AthenaFindManyAstPayload<Row, TSelect>;
}): AthenaFindManyDebugAst<Row, TSelect> {
  return {
    compiled: {
      baseState: cloneTableBuilderStateAst(input.baseState),
      columns: input.compiledColumns,
      executionState: cloneTableBuilderStateAst(input.executionState),
    },
    input: {
      limit: input.options.limit,
      orderBy: input.options.orderBy,
      select: input.options.select,
      where: input.options.where,
    },
    kind: "findMany",
    tableName: input.tableName,
    transport: {
      endpoint: "/gateway/fetch",
      mode: "direct-ast-fetch",
      payload: input.payload,
    },
    version: 1,
  };
}

function planToFindManyTransport<Row, TSelect extends AthenaSelectShape>(
  plan: AthenaSelectTransportPlan
): AthenaFindManyDebugTransport<Row, TSelect> {
  if (plan.kind === "query") {
    return {
      endpoint: "/gateway/query",
      mode: "compiled-query",
      payload: plan.payload,
    };
  }

  return {
    endpoint: "/gateway/fetch",
    mode:
      plan.payload.select === undefined ? "compiled-fetch" : "structured-fetch",
    payload: plan.payload,
  };
}

export function buildInsertDebugAst(
  payload: AthenaInsertPayload
): AthenaInsertDebugAst {
  return {
    input: {
      count: payload.count,
      defaultToNull: payload.default_to_null,
      head: payload.head,
      returning: payload.columns,
      values: payload.insert_body,
    },
    kind: "insert",
    tableName: payload.table_name,
    transport: {
      endpoint: "/gateway/insert",
      mode: "insert",
      payload,
    },
    version: 1,
  };
}

export function buildUpsertDebugAst(
  payload: AthenaInsertPayload
): AthenaUpsertDebugAst {
  return {
    input: {
      count: payload.count,
      defaultToNull: payload.default_to_null,
      head: payload.head,
      onConflict: payload.on_conflict,
      returning: payload.columns,
      updateBody: payload.update_body,
      values: payload.insert_body,
    },
    kind: "upsert",
    tableName: payload.table_name,
    transport: {
      endpoint: "/gateway/insert",
      mode: "upsert",
      payload,
    },
    version: 1,
  };
}

export function buildUpdateDebugAst(input: {
  state: AthenaTableBuilderStateAst;
  payload: AthenaUpdatePayload;
}): AthenaUpdateDebugAst {
  return {
    input: {
      returning: input.payload.columns,
      state: cloneTableBuilderStateAst(input.state),
      values: input.payload.update_body,
    },
    kind: "update",
    tableName: resolveDebugTableName(input.payload.table_name),
    transport: {
      endpoint: "/gateway/update",
      mode: "update",
      payload: input.payload,
    },
    version: 1,
  };
}

export function buildDeleteDebugAst(input: {
  state: AthenaTableBuilderStateAst;
  payload: AthenaDeletePayload;
}): AthenaDeleteDebugAst {
  return {
    input: {
      resourceId: input.payload.resource_id,
      returning: input.payload.columns,
      state: cloneTableBuilderStateAst(input.state),
    },
    kind: "delete",
    tableName: input.payload.table_name,
    transport: {
      endpoint: "/gateway/delete",
      mode: "delete",
      payload: input.payload,
    },
    version: 1,
  };
}

export function buildRpcDebugAst(input: {
  functionName: string;
  args?: AthenaJsonObject;
  selectedColumns?: string | string[];
  state: AthenaRpcBuilderStateAst;
  payload: AthenaRpcPayload;
  endpoint: "/gateway/rpc" | `/rpc/${string}`;
}): AthenaRpcDebugAst {
  return {
    functionName: input.functionName,
    input: {
      args: input.args,
      select: input.selectedColumns,
      state: cloneRpcBuilderStateAst(input.state),
    },
    kind: "rpc",
    transport: {
      endpoint: input.endpoint,
      mode: input.endpoint === "/gateway/rpc" ? "rpc-post" : "rpc-get",
      payload: input.payload,
    },
    version: 1,
  };
}

export function buildRawQueryDebugAst(query: string): AthenaRawQueryDebugAst {
  return {
    input: {
      query,
    },
    kind: "query",
    transport: {
      endpoint: "/gateway/query",
      mode: "raw-query",
      payload: {
        query,
      },
    },
    version: 1,
  };
}

export function attachAthenaDebugAst(
  target: unknown,
  ast: AthenaQueryDebugAst | undefined
): void {
  if (!ast) {
    return;
  }
  if (!target || (typeof target !== "object" && typeof target !== "function")) {
    return;
  }
  Object.defineProperty(target, ATHENA_DEBUG_AST_KEY, {
    configurable: true,
    enumerable: false,
    value: ast,
    writable: false,
  });
}

export function getAthenaDebugAst(value: unknown): AthenaQueryDebugAst | null {
  if (!value || (typeof value !== "object" && typeof value !== "function")) {
    return null;
  }
  return (
    ((value as Record<string, unknown>)[ATHENA_DEBUG_AST_KEY] as
      | AthenaQueryDebugAst
      | undefined) ?? null
  );
}
