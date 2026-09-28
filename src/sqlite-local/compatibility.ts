import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCondition,
  AthenaInsertPayload,
  AthenaUpdatePayload,
} from "../gateway/types.ts";
import {
  type CompareRightV1,
  type PredicateV1,
  type QueryOperationV1,
  type QueryRequestV1,
  type QueryValueV1,
  type ReturningV1,
  toQueryValue,
} from "../query/contract-v1.ts";

/**
 * Narrow legacy CRUD -> Query V1 projection for contract inspection.
 *
 * Query V1 projector only. Rust `athena-query` remains the sole SQL compiler.
 */

export interface AthenaSqliteProjectionOptions {
  readonly returning?: boolean;
}

export type AthenaSqliteOperation =
  | { kind: "fetch"; payload: AthenaFetchPayload }
  | { kind: "insert"; payload: AthenaInsertPayload }
  | { kind: "update"; payload: AthenaUpdatePayload }
  | { kind: "delete"; payload: AthenaDeletePayload };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

function identifier(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!IDENTIFIER.test(trimmed)) {
    throw new Error("Unsupported SQLite identifier.");
  }
  return trimmed;
}

function tableRef(name: string | undefined): { schema: null; name: string } {
  return { schema: null, name: identifier(name) };
}

function returning(value: boolean | undefined): ReturningV1 {
  return value ? "star" : "none";
}

function compareRight(value: unknown): CompareRightV1 {
  if (value === null || value === undefined) {
    return { none: null };
  }
  if (Array.isArray(value)) {
    return { values: value.map(toQueryValue) };
  }
  return { value: toQueryValue(value) };
}

function conditionColumn(condition: AthenaGatewayCondition): string {
  const column = condition.column ?? condition.eq_column;
  return identifier(column);
}

function predicateForCondition(condition: AthenaGatewayCondition): PredicateV1 {
  const operator = condition.operator;
  if (operator === "or") {
    const value = condition.value ?? condition.eq_value;
    if (!Array.isArray(value)) {
      throw new Error("SQLite OR conditions require an array.");
    }
    return {
      kind: "or",
      conditions: value.map((entry) =>
        predicateForCondition(entry as unknown as AthenaGatewayCondition),
      ),
    };
  }
  if (operator === "not") {
    const value = condition.value ?? condition.eq_value;
    if (!Array.isArray(value) || value.length !== 1) {
      throw new Error("SQLite NOT conditions require one condition.");
    }
    return {
      kind: "not",
      condition: predicateForCondition(
        value[0] as unknown as AthenaGatewayCondition,
      ),
    };
  }
  const column = conditionColumn(condition);
  const value =
    condition.value === undefined ? condition.eq_value : condition.value;
  switch (operator) {
    case "eq":
    case "neq":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "like":
    case "ilike":
    case "contains":
    case "containedBy":
      return {
        kind: "comparison",
        column,
        operator: operator === "containedBy" ? "contained_by" : operator,
        right: compareRight(value),
      };
    case "is":
      return {
        kind: "comparison",
        column,
        operator: value === null || value === undefined ? "is_null" : "eq",
        right:
          value === null || value === undefined
            ? { none: null }
            : { value: toQueryValue(value) },
      };
    case "in":
      return {
        kind: "comparison",
        column,
        operator: "in",
        right: {
          values: Array.isArray(value)
            ? value.map(toQueryValue)
            : [toQueryValue(value)],
        },
      };
    default:
      throw new Error(`Unsupported SQLite condition operator: ${operator}`);
  }
}

function predicate(
  conditions: readonly AthenaGatewayCondition[] | undefined,
): PredicateV1 {
  if (!conditions?.length) return { kind: "true" };
  const values = conditions.map(predicateForCondition);
  return values.length === 1 ? values[0] : { kind: "and", conditions: values };
}

function mutationPredicate(
  conditions: readonly AthenaGatewayCondition[] | undefined,
  resourceId?: string | null,
): PredicateV1 {
  const values = [...(conditions ?? [])];
  if (
    resourceId !== undefined &&
    resourceId !== null &&
    !values.some((condition) => {
      const column = condition.column ?? condition.eq_column;
      return column === "id" || column === "resource_id";
    })
  ) {
    values.unshift({ column: "id", operator: "eq", value: resourceId });
  }
  return predicate(values);
}

function selection(
  columns: string[] | string | undefined,
): "all" | { columns: string[] } {
  if (!columns) return "all";
  const values = (Array.isArray(columns) ? columns : columns.split(","))
    .map((column) => column.trim())
    .filter(Boolean);
  if (!values.length || values.includes("*")) return "all";
  return { columns: values.map(identifier) };
}

function rowValue(
  value: unknown,
  defaultToNull: boolean,
): { value: QueryValueV1 } | { default: null } {
  if (value === undefined && !defaultToNull) return { default: null };
  return { value: toQueryValue(value === undefined ? null : value) };
}

function insertRequest(
  payload: AthenaInsertPayload,
  options?: AthenaSqliteProjectionOptions,
): QueryRequestV1<QueryOperationV1> {
  if (payload.on_conflict !== undefined || payload.update_body !== undefined) {
    throw new Error(
      "SQLite Query V1 compatibility projection does not support upsert conflict semantics yet.",
    );
  }
  const rows = Array.isArray(payload.insert_body)
    ? payload.insert_body
    : [payload.insert_body];
  if (!rows.length || rows.some((row) => !row || typeof row !== "object")) {
    throw new Error("SQLite insert values must be objects.");
  }
  const records = rows as Record<string, unknown>[];
  const columns =
    payload.columns && payload.columns !== "*"
      ? (Array.isArray(payload.columns)
          ? payload.columns
          : payload.columns.split(",")
        ).map((column) => column.trim())
      : Object.keys(records[0] ?? {});
  if (!columns.length) throw new Error("SQLite insert requires columns.");
  return {
    version: 1,
    operation: {
      kind: "insert",
      into: tableRef(payload.table_name),
      columns: columns.map(identifier),
      rows: records.map((record) =>
        columns.map((column) =>
          rowValue(record[column], payload.default_to_null === true),
        ),
      ),
      returning: returning(options?.returning),
    },
  };
}

export function projectSqliteOperationToQueryV1(
  operation: AthenaSqliteOperation,
  options?: AthenaSqliteProjectionOptions,
): QueryRequestV1<QueryOperationV1> {
  switch (operation.kind) {
    case "fetch": {
      const payload = operation.payload;
      return {
        version: 1,
        operation: {
          kind: "select",
          from: tableRef(payload.table_name),
          selection: selection(payload.columns),
          predicate: predicate(payload.conditions),
          order_by: payload.sort_by
            ? [
                {
                  column: identifier(payload.sort_by.field),
                  direction:
                    payload.sort_by.direction === "descending" ? "desc" : "asc",
                  nulls: null,
                },
              ]
            : [],
          pagination: {
            limit: payload.limit ?? payload.page_size ?? null,
            offset: payload.offset ?? null,
          },
          for_update: false,
        },
      };
    }
    case "insert":
      return insertRequest(operation.payload, options);
    case "update": {
      const values = operation.payload.update_body;
      if (!values || typeof values !== "object" || Array.isArray(values)) {
        throw new Error("SQLite update values must be an object.");
      }
      const assignments = Object.entries(values).map(([column, value]) => ({
        column: identifier(column),
        value: rowValue(value, false),
      }));
      return {
        version: 1,
        operation: {
          kind: "update",
          table: tableRef(operation.payload.table_name),
          assignments,
          predicate: mutationPredicate(operation.payload.conditions),
          returning: returning(options?.returning),
          safety: "require_filter",
        },
      };
    }
    case "delete":
      return {
        version: 1,
        operation: {
          kind: "delete",
          table: tableRef(operation.payload.table_name),
          predicate: mutationPredicate(
            operation.payload.conditions,
            operation.payload.resource_id,
          ),
          returning: "none",
          safety: "require_filter",
        },
      };
  }
}
