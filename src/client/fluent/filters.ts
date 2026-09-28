import type {
  AthenaConditionArrayValue,
  AthenaConditionCastType,
  AthenaConditionOperator,
  AthenaConditionValue,
} from "../../gateway/types.ts";
import { shouldUseUuidTextComparison } from "../../query-ast.ts";
import type {
  ConditionCastHints,
  FilterChain,
  OrderOptions,
  TableBuilderState,
} from "./types.ts";

export function createFilterMethods<Self, Row>(
  state: TableBuilderState,
  addCondition: (
    operator: AthenaConditionOperator,
    column?: string,
    value?: AthenaConditionValue | AthenaConditionArrayValue | string,
    hints?: ConditionCastHints
  ) => void,
  self: Self
): FilterChain<Self, Row> {
  return {
    containedBy(column, values) {
      addCondition("containedBy", String(column), values);
      return self;
    },
    contains(column, values) {
      addCondition("contains", String(column), values);
      return self;
    },
    currentPage(value) {
      state.currentPage = value;
      return self;
    },
    eq(column, value) {
      const columnName = String(column);
      addCondition(
        "eq",
        columnName,
        value,
        shouldUseUuidTextComparison(columnName, value)
          ? { columnCast: "text" }
          : undefined
      );
      return self;
    },
    eqCast(column, value, cast: AthenaConditionCastType) {
      addCondition("eq", String(column), value, { valueCast: cast });
      return self;
    },
    eqUuid(column, value) {
      addCondition("eq", String(column), value, { valueCast: "uuid" });
      return self;
    },
    gt(column, value) {
      addCondition("gt", String(column), value);
      return self;
    },
    gte(column, value) {
      addCondition("gte", String(column), value);
      return self;
    },
    ilike(column, value) {
      addCondition("ilike", String(column), value);
      return self;
    },
    in(column, values) {
      addCondition("in", String(column), values);
      return self;
    },
    is(column, value) {
      addCondition("is", String(column), value);
      return self;
    },
    like(column, value) {
      addCondition("like", String(column), value);
      return self;
    },
    limit(count) {
      state.limit = count;
      return self;
    },
    lt(column, value) {
      addCondition("lt", String(column), value);
      return self;
    },
    lte(column, value) {
      addCondition("lte", String(column), value);
      return self;
    },
    match(filters) {
      for (const [column, value] of Object.entries(
        filters as Record<string, AthenaConditionValue | undefined>
      )) {
        if (value === undefined) {
          continue;
        }
        addCondition(
          "eq",
          column,
          value,
          shouldUseUuidTextComparison(column, value)
            ? { columnCast: "text" }
            : undefined
        );
      }
      return self;
    },
    neq(column, value) {
      addCondition("neq", String(column), value);
      return self;
    },
    not(columnOrExpression, operator, value) {
      const expression = String(columnOrExpression);
      addCondition(
        "not",
        undefined,
        operator !== null && value !== undefined
          ? `${expression}.${operator}.${stringifyFilterValue(value)}`
          : expression
      );
      return self;
    },
    offset(count) {
      state.offset = count;
      return self;
    },
    or(expression) {
      addCondition("or", undefined, expression);
      return self;
    },
    order(column, options?: OrderOptions) {
      state.order = {
        direction: options?.ascending === false ? "descending" : "ascending",
        field: String(column),
      };
      return self;
    },
    pageSize(value) {
      state.pageSize = value;
      return self;
    },
    range(from, to) {
      state.offset = from;
      state.limit = to - from + 1;
      return self;
    },
    totalPages(value) {
      state.totalPages = value;
      return self;
    },
  };
}

function stringifyFilterValue(
  value: AthenaConditionValue | AthenaConditionArrayValue | string
): string {
  return Array.isArray(value) ? value.join(",") : String(value);
}
