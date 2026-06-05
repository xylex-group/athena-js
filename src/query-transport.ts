import { buildStructuredSelectTransport } from './gateway/structured-select.ts'
import type {
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaSortBy,
} from './gateway/types.ts'
import type { AthenaOrderBy, AthenaSelectShape, AthenaWhere } from './query-ast.ts'

type AthenaFindManyAstOrderColumn<Row> =
  [Extract<keyof NonNullable<Row>, string>] extends [never] ? string : Extract<keyof NonNullable<Row>, string>

export interface AthenaSelectExecutionState {
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  order?: AthenaSortBy
  currentPage?: number
  pageSize?: number
  totalPages?: number
}

export type AthenaFindManyAstPayload<
  Row,
  TSelect extends AthenaSelectShape,
> = {
  table_name: string
  select: TSelect
  where?: AthenaWhere<Row>
  orderBy?: AthenaOrderBy<Row>
  limit?: number
}

export interface AthenaResolvedPagination {
  limit?: number
  offset?: number
}

export interface AthenaTypedSelectQueryInput {
  tableName: string
  columns: string | string[]
  conditions: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
  order?: AthenaSortBy
}

export interface AthenaSelectDebugPlan {
  columns: string | string[]
  conditions?: AthenaGatewayCondition[]
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
  order?: AthenaSortBy
}

export type AthenaSelectTransportPlan =
  | {
      kind: 'query'
      query: string
      payload: {
        query: string
      }
    }
  | {
      kind: 'fetch'
      payload: AthenaFetchPayload
      debug: AthenaSelectDebugPlan
    }

export function canUseFindManyAstTransport(state: AthenaSelectExecutionState): boolean {
  return (
    state.conditions.length === 0 &&
    state.offset === undefined &&
    state.currentPage === undefined &&
    state.pageSize === undefined &&
    state.totalPages === undefined
  )
}

export function toFindManyAstOrder<Row>(order?: AthenaSortBy): AthenaOrderBy<Row> | undefined {
  if (!order) {
    return undefined
  }
  return {
    column: order.field as AthenaFindManyAstOrderColumn<Row>,
    ascending: order.direction !== 'descending',
  }
}

export function resolvePagination(input: {
  limit?: number
  offset?: number
  currentPage?: number
  pageSize?: number
}): AthenaResolvedPagination {
  let limit = input.limit
  let offset = input.offset

  if (limit === undefined && input.pageSize !== undefined) {
    limit = Math.max(0, Math.trunc(input.pageSize))
  }
  if (
    offset === undefined &&
    input.pageSize !== undefined &&
    input.currentPage !== undefined &&
    input.currentPage > 0
  ) {
    offset = (Math.trunc(input.currentPage) - 1) * Math.max(0, Math.trunc(input.pageSize))
  }

  return { limit, offset }
}

function hasTypedEqualityComparison(conditions: AthenaGatewayCondition[] | undefined): boolean {
  return (
    conditions?.some(
      condition =>
        condition.operator === 'eq' &&
        (condition.value_cast !== undefined || condition.column_cast !== undefined),
    ) ?? false
  )
}

export function createSelectTransportPlan(input: {
  tableName: string
  columns: string | string[]
  state: AthenaSelectExecutionState
  options?: AthenaGatewayCallOptions
  buildTypedSelectQuery: (input: AthenaTypedSelectQueryInput) => string | null
}): AthenaSelectTransportPlan {
  const conditions = input.state.conditions.length
    ? input.state.conditions.map(condition => ({ ...condition }))
    : undefined

  if (hasTypedEqualityComparison(conditions) && !input.options?.head && !input.options?.count && conditions) {
    const query = input.buildTypedSelectQuery({
      tableName: input.tableName,
      columns: input.columns,
      conditions,
      limit: input.state.limit,
      offset: input.state.offset,
      currentPage: input.state.currentPage,
      pageSize: input.state.pageSize,
      order: input.state.order,
    })
    if (query) {
      return {
        kind: 'query',
        query,
        payload: { query },
      }
    }
  }

  const pagination = resolvePagination({
    limit: input.state.limit,
    offset: input.state.offset,
    currentPage: input.state.currentPage,
    pageSize: input.state.pageSize,
  })
  const stripNulls = input.options?.stripNulls ?? true
  const structuredSelectTransport = buildStructuredSelectTransport({
    tableName: input.tableName,
    columns: input.columns,
    conditions,
    limit: pagination.limit,
    offset: pagination.offset,
    order: input.state.order,
    stripNulls,
    count: input.options?.count,
    head: input.options?.head,
  })
  if (structuredSelectTransport && 'error' in structuredSelectTransport) {
    throw new Error(structuredSelectTransport.error)
  }
  if (structuredSelectTransport) {
    const { payload, select } = structuredSelectTransport
    return {
      kind: 'fetch',
      payload,
      debug: {
        columns: select,
        conditions,
        limit: pagination.limit,
        offset: pagination.offset,
        order: input.state.order,
      },
    }
  }

  return {
    kind: 'fetch',
    payload: {
      table_name: input.tableName,
      columns: input.columns,
      conditions,
      limit: input.state.limit,
      offset: input.state.offset,
      current_page: input.state.currentPage,
      page_size: input.state.pageSize,
      total_pages: input.state.totalPages,
      sort_by: input.state.order,
      strip_nulls: stripNulls,
      count: input.options?.count,
      head: input.options?.head,
    },
    debug: {
      columns: input.columns,
      conditions,
      limit: input.state.limit,
      offset: input.state.offset,
      currentPage: input.state.currentPage,
      pageSize: input.state.pageSize,
      order: input.state.order,
    },
  }
}
