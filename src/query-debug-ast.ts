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
} from './gateway/types.ts'
import type {
  AthenaFindManyOptions,
  AthenaOrderBy,
  AthenaSelectShape,
  AthenaValidatedSelectShape,
  AthenaWhere,
} from './query-ast.ts'
import type { AthenaFindManyAstPayload, AthenaSelectTransportPlan } from './query-transport.ts'

const ATHENA_DEBUG_AST_KEY = '__athenaDebugAst' as const

export interface AthenaTableBuilderStateAst {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  order?: AthenaSortBy
  currentPage?: number
  pageSize?: number
  totalPages?: number
}

export interface AthenaRpcBuilderStateAst {
  filters: AthenaRpcFilter[]
  limit?: number
  offset?: number
  order?: {
    column: string
    ascending?: boolean
  }
}

export type AthenaDebugQueryEndpoint =
  | '/gateway/fetch'
  | '/gateway/insert'
  | '/gateway/update'
  | '/gateway/delete'
  | '/gateway/rpc'
  | '/gateway/query'
  | `/rpc/${string}`

interface AthenaDebugAstBase<TKind extends string> {
  version: 1
  kind: TKind
}

export type AthenaSelectDebugTransport =
  | {
      mode: 'compiled-fetch' | 'structured-fetch'
      endpoint: '/gateway/fetch'
      payload: AthenaFetchPayload
    }
  | {
      mode: 'typed-query'
      endpoint: '/gateway/query'
      payload: {
        query: string
      }
    }

export interface AthenaSelectDebugAst extends AthenaDebugAstBase<'select'> {
  tableName: string
  input: {
    columns: string | string[]
    state: AthenaTableBuilderStateAst
  }
  transport: AthenaSelectDebugTransport
}

export type AthenaFindManyDebugTransport<
  Row = Record<string, unknown>,
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> =
  | {
      mode: 'direct-ast-fetch'
      endpoint: '/gateway/fetch'
      payload: AthenaFindManyAstPayload<Row, TSelect>
    }
  | {
      mode: 'compiled-fetch' | 'structured-fetch'
      endpoint: '/gateway/fetch'
      payload: AthenaFetchPayload
    }
  | {
      mode: 'compiled-query'
      endpoint: '/gateway/query'
      payload: {
        query: string
      }
    }

export interface AthenaFindManyDebugAst<
  Row = Record<string, unknown>,
  TSelect extends AthenaSelectShape = AthenaSelectShape,
> extends AthenaDebugAstBase<'findMany'> {
  tableName: string
  input: {
    select: AthenaValidatedSelectShape<TSelect>
    where?: AthenaWhere<Row>
    orderBy?: AthenaOrderBy<Row>
    limit?: number
  }
  compiled: {
    columns: string
    baseState: AthenaTableBuilderStateAst
    executionState: AthenaTableBuilderStateAst
  }
  transport: AthenaFindManyDebugTransport<Row, TSelect>
}

export interface AthenaInsertDebugAst extends AthenaDebugAstBase<'insert'> {
  tableName: string
  input: {
    values: AthenaInsertPayload['insert_body']
    returning?: AthenaInsertPayload['columns']
    count?: AthenaInsertPayload['count']
    head?: boolean
    defaultToNull?: boolean
  }
  transport: {
    mode: 'insert'
    endpoint: '/gateway/insert'
    payload: AthenaInsertPayload
  }
}

export interface AthenaUpsertDebugAst extends AthenaDebugAstBase<'upsert'> {
  tableName: string
  input: {
    values: AthenaInsertPayload['insert_body']
    updateBody?: AthenaInsertPayload['update_body']
    onConflict?: AthenaInsertPayload['on_conflict']
    returning?: AthenaInsertPayload['columns']
    count?: AthenaInsertPayload['count']
    head?: boolean
    defaultToNull?: boolean
  }
  transport: {
    mode: 'upsert'
    endpoint: '/gateway/insert'
    payload: AthenaInsertPayload
  }
}

export interface AthenaUpdateDebugAst extends AthenaDebugAstBase<'update'> {
  tableName: string
  input: {
    values: AthenaUpdatePayload['set']
    state: AthenaTableBuilderStateAst
    returning?: AthenaUpdatePayload['columns']
  }
  transport: {
    mode: 'update'
    endpoint: '/gateway/update'
    payload: AthenaUpdatePayload
  }
}

export interface AthenaDeleteDebugAst extends AthenaDebugAstBase<'delete'> {
  tableName: string
  input: {
    resourceId?: AthenaDeletePayload['resource_id']
    state: AthenaTableBuilderStateAst
    returning?: AthenaDeletePayload['columns']
  }
  transport: {
    mode: 'delete'
    endpoint: '/gateway/delete'
    payload: AthenaDeletePayload
  }
}

export interface AthenaRpcDebugAst extends AthenaDebugAstBase<'rpc'> {
  functionName: string
  input: {
    args?: AthenaJsonObject
    select?: string | string[]
    state: AthenaRpcBuilderStateAst
  }
  transport: {
    mode: 'rpc-post' | 'rpc-get'
    endpoint: '/gateway/rpc' | `/rpc/${string}`
    payload: AthenaRpcPayload
  }
}

export interface AthenaRawQueryDebugAst extends AthenaDebugAstBase<'query'> {
  input: {
    query: string
  }
  transport: {
    mode: 'raw-query'
    endpoint: '/gateway/query'
    payload: {
      query: string
    }
  }
}

export type AthenaQueryDebugAst =
  | AthenaSelectDebugAst
  | AthenaFindManyDebugAst
  | AthenaInsertDebugAst
  | AthenaUpsertDebugAst
  | AthenaUpdateDebugAst
  | AthenaDeleteDebugAst
  | AthenaRpcDebugAst
  | AthenaRawQueryDebugAst

function cloneConditions(conditions: AthenaGatewayCondition[]): AthenaGatewayCondition[] {
  return conditions.map(condition => ({ ...condition }))
}

export function cloneTableBuilderStateAst(
  state: AthenaTableBuilderStateAst,
): AthenaTableBuilderStateAst {
  return {
    conditions: cloneConditions(state.conditions),
    limit: state.limit,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
    currentPage: state.currentPage,
    pageSize: state.pageSize,
    totalPages: state.totalPages,
  }
}

export function cloneRpcBuilderStateAst(
  state: AthenaRpcBuilderStateAst,
): AthenaRpcBuilderStateAst {
  return {
    filters: state.filters.map(filter => ({ ...filter })),
    limit: state.limit,
    offset: state.offset,
    order: state.order ? { ...state.order } : undefined,
  }
}

function toSelectTransportAst(plan: AthenaSelectTransportPlan): AthenaSelectDebugTransport {
  if (plan.kind === 'query') {
    return {
      mode: 'typed-query',
      endpoint: '/gateway/query',
      payload: plan.payload,
    }
  }

  return {
    mode: plan.payload.select !== undefined ? 'structured-fetch' : 'compiled-fetch',
    endpoint: '/gateway/fetch',
    payload: plan.payload,
  }
}

function resolveDebugTableName(tableName: string | undefined): string {
  return tableName ?? '__unknown_table__'
}

export function buildSelectDebugAst(input: {
  tableName: string
  columns: string | string[]
  state: AthenaTableBuilderStateAst
  plan: AthenaSelectTransportPlan
}): AthenaSelectDebugAst {
  return {
    version: 1,
    kind: 'select',
    tableName: input.tableName,
    input: {
      columns: input.columns,
      state: cloneTableBuilderStateAst(input.state),
    },
    transport: toSelectTransportAst(input.plan),
  }
}

export function buildFindManyCompiledDebugAst<
  Row,
  TSelect extends AthenaSelectShape,
>(input: {
  tableName: string
  options: AthenaFindManyOptions<Row, TSelect> & {
    select: AthenaValidatedSelectShape<TSelect>
  }
  compiledColumns: string
  baseState: AthenaTableBuilderStateAst
  executionState: AthenaTableBuilderStateAst
  plan: AthenaSelectTransportPlan
}): AthenaFindManyDebugAst<Row, TSelect> {
  return {
    version: 1,
    kind: 'findMany',
    tableName: input.tableName,
    input: {
      select: input.options.select,
      where: input.options.where,
      orderBy: input.options.orderBy,
      limit: input.options.limit,
    },
    compiled: {
      columns: input.compiledColumns,
      baseState: cloneTableBuilderStateAst(input.baseState),
      executionState: cloneTableBuilderStateAst(input.executionState),
    },
    transport: planToFindManyTransport<Row, TSelect>(input.plan),
  }
}

export function buildFindManyDirectDebugAst<
  Row,
  TSelect extends AthenaSelectShape,
>(input: {
  tableName: string
  options: AthenaFindManyOptions<Row, TSelect> & {
    select: AthenaValidatedSelectShape<TSelect>
  }
  compiledColumns: string
  baseState: AthenaTableBuilderStateAst
  executionState: AthenaTableBuilderStateAst
  payload: AthenaFindManyAstPayload<Row, TSelect>
}): AthenaFindManyDebugAst<Row, TSelect> {
  return {
    version: 1,
    kind: 'findMany',
    tableName: input.tableName,
    input: {
      select: input.options.select,
      where: input.options.where,
      orderBy: input.options.orderBy,
      limit: input.options.limit,
    },
    compiled: {
      columns: input.compiledColumns,
      baseState: cloneTableBuilderStateAst(input.baseState),
      executionState: cloneTableBuilderStateAst(input.executionState),
    },
    transport: {
      mode: 'direct-ast-fetch',
      endpoint: '/gateway/fetch',
      payload: input.payload,
    },
  }
}

function planToFindManyTransport<
  Row,
  TSelect extends AthenaSelectShape,
>(
  plan: AthenaSelectTransportPlan,
): AthenaFindManyDebugTransport<Row, TSelect> {
  if (plan.kind === 'query') {
    return {
      mode: 'compiled-query',
      endpoint: '/gateway/query',
      payload: plan.payload,
    }
  }

  return {
    mode: plan.payload.select !== undefined ? 'structured-fetch' : 'compiled-fetch',
    endpoint: '/gateway/fetch',
    payload: plan.payload,
  }
}

export function buildInsertDebugAst(payload: AthenaInsertPayload): AthenaInsertDebugAst {
  return {
    version: 1,
    kind: 'insert',
    tableName: payload.table_name,
    input: {
      values: payload.insert_body,
      returning: payload.columns,
      count: payload.count,
      head: payload.head,
      defaultToNull: payload.default_to_null,
    },
    transport: {
      mode: 'insert',
      endpoint: '/gateway/insert',
      payload,
    },
  }
}

export function buildUpsertDebugAst(payload: AthenaInsertPayload): AthenaUpsertDebugAst {
  return {
    version: 1,
    kind: 'upsert',
    tableName: payload.table_name,
    input: {
      values: payload.insert_body,
      updateBody: payload.update_body,
      onConflict: payload.on_conflict,
      returning: payload.columns,
      count: payload.count,
      head: payload.head,
      defaultToNull: payload.default_to_null,
    },
    transport: {
      mode: 'upsert',
      endpoint: '/gateway/insert',
      payload,
    },
  }
}

export function buildUpdateDebugAst(input: {
  state: AthenaTableBuilderStateAst
  payload: AthenaUpdatePayload
}): AthenaUpdateDebugAst {
  return {
    version: 1,
    kind: 'update',
    tableName: resolveDebugTableName(input.payload.table_name),
    input: {
      values: input.payload.set,
      state: cloneTableBuilderStateAst(input.state),
      returning: input.payload.columns,
    },
    transport: {
      mode: 'update',
      endpoint: '/gateway/update',
      payload: input.payload,
    },
  }
}

export function buildDeleteDebugAst(input: {
  state: AthenaTableBuilderStateAst
  payload: AthenaDeletePayload
}): AthenaDeleteDebugAst {
  return {
    version: 1,
    kind: 'delete',
    tableName: input.payload.table_name,
    input: {
      resourceId: input.payload.resource_id,
      state: cloneTableBuilderStateAst(input.state),
      returning: input.payload.columns,
    },
    transport: {
      mode: 'delete',
      endpoint: '/gateway/delete',
      payload: input.payload,
    },
  }
}

export function buildRpcDebugAst(input: {
  functionName: string
  args?: AthenaJsonObject
  selectedColumns?: string | string[]
  state: AthenaRpcBuilderStateAst
  payload: AthenaRpcPayload
  endpoint: '/gateway/rpc' | `/rpc/${string}`
}): AthenaRpcDebugAst {
  return {
    version: 1,
    kind: 'rpc',
    functionName: input.functionName,
    input: {
      args: input.args,
      select: input.selectedColumns,
      state: cloneRpcBuilderStateAst(input.state),
    },
    transport: {
      mode: input.endpoint === '/gateway/rpc' ? 'rpc-post' : 'rpc-get',
      endpoint: input.endpoint,
      payload: input.payload,
    },
  }
}

export function buildRawQueryDebugAst(query: string): AthenaRawQueryDebugAst {
  return {
    version: 1,
    kind: 'query',
    input: {
      query,
    },
    transport: {
      mode: 'raw-query',
      endpoint: '/gateway/query',
      payload: {
        query,
      },
    },
  }
}

export function attachAthenaDebugAst(
  target: unknown,
  ast: AthenaQueryDebugAst | undefined,
): void {
  if (!ast) {
    return
  }
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return
  }
  Object.defineProperty(target, ATHENA_DEBUG_AST_KEY, {
    value: ast,
    enumerable: false,
    configurable: true,
    writable: false,
  })
}

export function getAthenaDebugAst(
  value: unknown,
): AthenaQueryDebugAst | null {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) {
    return null
  }
  return ((value as Record<string, unknown>)[ATHENA_DEBUG_AST_KEY] as AthenaQueryDebugAst | undefined) ?? null
}
