import { buildStructuredSelectTransport } from "./gateway/structured-select.ts";
import type { AthenaRelationDescriptor } from "./query/descriptor.ts";
import { compileIncludeSelectString } from "./query/include-select.ts";
import type {
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayCondition,
  AthenaJsonObject,
  AthenaJsonValue,
  AthenaSortBy,
} from "./gateway/types.ts";
import type {
  AthenaOrderBy,
  AthenaSelectShape,
  AthenaWhere,
  AthenaWhereBooleanOperand,
  AthenaWhereOperatorInput,
} from "./query-ast.ts";
import { shouldUseUuidTextComparison } from "./query-ast.ts";

type AthenaFindManyAstOrderColumn<Row> = [
  Extract<keyof NonNullable<Row>, string>,
] extends [never]
  ? string
  : Extract<keyof NonNullable<Row>, string>;

export interface AthenaSelectExecutionState {
  conditions: AthenaGatewayCondition[];
  currentPage?: number;
  limit?: number;
  offset?: number;
  order?: AthenaSortBy;
  pageSize?: number;
  relations?: AthenaRelationDescriptor[];
  totalPages?: number;
}

export interface AthenaFindManyAstPayload<
  Row,
  TSelect extends AthenaSelectShape,
> {
  limit?: number;
  orderBy?: AthenaOrderBy<Row>;
  select: TSelect;
  table_name: string;
  where?: AthenaWhere<Row>;
}

export interface AthenaResolvedPagination {
  limit?: number;
  offset?: number;
}

export interface AthenaTypedSelectQueryInput {
  columns: string | string[];
  conditions: AthenaGatewayCondition[];
  currentPage?: number;
  limit?: number;
  offset?: number;
  order?: AthenaSortBy;
  pageSize?: number;
  tableName: string;
}

export interface AthenaSelectDebugPlan {
  columns: string | string[];
  conditions?: AthenaGatewayCondition[];
  currentPage?: number;
  limit?: number;
  offset?: number;
  order?: AthenaSortBy;
  pageSize?: number;
}

export type AthenaSelectTransportPlan =
  | {
      kind: "query";
      query: string;
      payload: {
        query: string;
      };
    }
  | {
      kind: "fetch";
      payload: AthenaFetchPayload;
      debug: AthenaSelectDebugPlan;
    };

export function canUseFindManyAstTransport(
  state: AthenaSelectExecutionState
): boolean {
  return (
    state.conditions.length === 0 &&
    state.offset === undefined &&
    state.currentPage === undefined &&
    state.pageSize === undefined &&
    state.totalPages === undefined
  );
}

export function toFindManyAstOrder<Row>(
  order?: AthenaSortBy
): AthenaOrderBy<Row> | undefined {
  if (!order) {
    return;
  }
  return {
    ascending: order.direction !== "descending",
    column: order.field as AthenaFindManyAstOrderColumn<Row>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeFindManyAstColumnPredicate(
  value: unknown
): AthenaWhereOperatorInput {
  if (!isRecord(value)) {
    return {
      eq: value as AthenaWhereOperatorInput["eq"],
    };
  }

  const normalized: AthenaWhereOperatorInput = {};
  for (const [key, operand] of Object.entries(value)) {
    if (operand !== undefined) {
      normalized[key as keyof AthenaWhereOperatorInput] = operand as never;
    }
  }
  return normalized;
}

function normalizeFindManyAstBooleanOperand<Row>(
  clause: AthenaWhereBooleanOperand<Row>
): AthenaWhereBooleanOperand<Row> {
  const normalized: Record<string, unknown> = {};
  for (const [column, value] of Object.entries(
    clause as Record<string, unknown>
  )) {
    if (value === undefined) {
      continue;
    }
    normalized[column] = normalizeFindManyAstColumnPredicate(value);
  }
  return normalized as AthenaWhereBooleanOperand<Row>;
}

export function normalizeFindManyAstWhere<Row>(
  where?: AthenaWhere<Row>
): AthenaWhere<Row> | undefined {
  if (!(where && isRecord(where))) {
    return where;
  }

  const normalized: AthenaJsonObject = {};
  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    if (key === "or" && Array.isArray(value)) {
      normalized.or = value.map((clause) =>
        normalizeFindManyAstBooleanOperand(
          clause as AthenaWhereBooleanOperand<Row>
        )
      ) as unknown as AthenaJsonObject["or"];
      continue;
    }
    if (key === "not" && isRecord(value)) {
      normalized.not = normalizeFindManyAstBooleanOperand(
        value as AthenaWhereBooleanOperand<Row>
      ) as unknown as AthenaJsonObject["not"];
      continue;
    }
    normalized[key] = normalizeFindManyAstColumnPredicate(
      value
    ) as AthenaJsonValue;
  }

  return normalized as AthenaWhere<Row>;
}

function predicateRequiresUuidQueryFallback(
  column: string,
  value: unknown
): boolean {
  if (!isRecord(value)) {
    return shouldUseUuidTextComparison(
      column,
      value as Parameters<typeof shouldUseUuidTextComparison>[1]
    );
  }

  const eqValue = value.eq;
  return (
    eqValue !== undefined &&
    shouldUseUuidTextComparison(
      column,
      eqValue as Parameters<typeof shouldUseUuidTextComparison>[1]
    )
  );
}

function booleanOperandRequiresUuidQueryFallback<Row>(
  clause: AthenaWhereBooleanOperand<Row>
): boolean {
  for (const [column, value] of Object.entries(
    clause as Record<string, unknown>
  )) {
    if (value === undefined) {
      continue;
    }
    if (predicateRequiresUuidQueryFallback(column, value)) {
      return true;
    }
  }
  return false;
}

export function findManyAstWhereRequiresLegacyTransport<Row>(
  where?: AthenaWhere<Row>
): boolean {
  if (!(where && isRecord(where))) {
    return false;
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    if (key === "or" && Array.isArray(value)) {
      if (
        value.some((clause) =>
          booleanOperandRequiresUuidQueryFallback(
            clause as AthenaWhereBooleanOperand<Row>
          )
        )
      ) {
        return true;
      }
      continue;
    }
    if (key === "not" && isRecord(value)) {
      if (
        booleanOperandRequiresUuidQueryFallback(
          value as AthenaWhereBooleanOperand<Row>
        )
      ) {
        return true;
      }
      continue;
    }
    if (predicateRequiresUuidQueryFallback(key, value)) {
      return true;
    }
  }

  return false;
}

export function resolvePagination(input: {
  limit?: number;
  offset?: number;
  currentPage?: number;
  pageSize?: number;
}): AthenaResolvedPagination {
  let limit = input.limit;
  let offset = input.offset;

  if (limit === undefined && input.pageSize !== undefined) {
    limit = Math.max(0, Math.trunc(input.pageSize));
  }
  if (
    offset === undefined &&
    input.pageSize !== undefined &&
    input.currentPage !== undefined &&
    input.currentPage > 0
  ) {
    offset =
      (Math.trunc(input.currentPage) - 1) *
      Math.max(0, Math.trunc(input.pageSize));
  }

  return { limit, offset };
}

function hasTypedEqualityComparison(
  conditions: AthenaGatewayCondition[] | undefined
): boolean {
  return (
    conditions?.some(
      (condition) =>
        condition.operator === "eq" &&
        (condition.value_cast !== undefined ||
          condition.column_cast !== undefined)
    ) ?? false
  );
}

export function createSelectTransportPlan(input: {
  tableName: string;
  columns: string | string[];
  state: AthenaSelectExecutionState;
  options?: AthenaGatewayCallOptions;
  buildTypedSelectQuery: (input: AthenaTypedSelectQueryInput) => string | null;
}): AthenaSelectTransportPlan {
  const conditions = input.state.conditions.length
    ? input.state.conditions.map((condition) => ({ ...condition }))
    : undefined;

  const pagination = resolvePagination({
    currentPage: input.state.currentPage,
    limit: input.state.limit,
    offset: input.state.offset,
    pageSize: input.state.pageSize,
  });
  const stripNulls = input.options?.stripNulls ?? true;
  const includeSelect =
    input.state.relations && input.state.relations.length > 0
      ? compileIncludeSelectString(input.columns, input.state.relations)
      : undefined;
  if (includeSelect) {
    const where = conditions
      ? Object.fromEntries(
          conditions
            .filter((condition) => condition.column && condition.operator === "eq")
            .map((condition) => [
              condition.column as string,
              { eq: condition.value ?? null },
            ])
        )
      : undefined;
    return {
      debug: {
        columns: includeSelect,
        conditions,
        limit: pagination.limit,
        offset: pagination.offset,
        order: input.state.order,
      },
      kind: "fetch",
      payload: {
        limit: pagination.limit,
        offset: pagination.offset,
        orderBy: input.state.order
          ? {
              [input.state.order.field]:
                input.state.order.direction === "descending" ? "desc" : "asc",
            }
          : undefined,
        select: includeSelect,
        strip_nulls: stripNulls,
        table_name: input.tableName,
        where,
      },
    };
  }
  const structuredSelectTransport = buildStructuredSelectTransport({
    columns: input.columns,
    conditions,
    count: input.options?.count,
    head: input.options?.head,
    limit: pagination.limit,
    offset: pagination.offset,
    order: input.state.order,
    stripNulls,
    tableName: input.tableName,
  });
  if (structuredSelectTransport && "error" in structuredSelectTransport) {
    throw new Error(structuredSelectTransport.error);
  }
  if (structuredSelectTransport) {
    const { payload, select } = structuredSelectTransport;
    return {
      debug: {
        columns: select,
        conditions,
        limit: pagination.limit,
        offset: pagination.offset,
        order: input.state.order,
      },
      kind: "fetch",
      payload,
    };
  }

  if (
    hasTypedEqualityComparison(conditions) &&
    !input.options?.head &&
    !input.options?.count &&
    conditions
  ) {
    const query = input.buildTypedSelectQuery({
      columns: input.columns,
      conditions,
      currentPage: input.state.currentPage,
      limit: input.state.limit,
      offset: input.state.offset,
      order: input.state.order,
      pageSize: input.state.pageSize,
      tableName: input.tableName,
    });
    if (query) {
      return {
        kind: "query",
        payload: { query },
        query,
      };
    }
  }

  return {
    debug: {
      columns: input.columns,
      conditions,
      currentPage: input.state.currentPage,
      limit: input.state.limit,
      offset: input.state.offset,
      order: input.state.order,
      pageSize: input.state.pageSize,
    },
    kind: "fetch",
    payload: {
      columns: input.columns,
      conditions,
      count: input.options?.count,
      current_page: input.state.currentPage,
      head: input.options?.head,
      limit: input.state.limit,
      offset: input.state.offset,
      page_size: input.state.pageSize,
      sort_by: input.state.order,
      strip_nulls: stripNulls,
      table_name: input.tableName,
      total_pages: input.state.totalPages,
    },
  };
}
