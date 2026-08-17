import type { AthenaGatewayCondition, AthenaSortBy } from "../gateway/types.ts";
import {
  type AthenaCacheContextDescriptor,
  type AthenaQueryDescriptor,
  compileAthenaQueryDescriptor,
} from "./descriptor.ts";
import {
  type AthenaReadQueryDefinition,
  type AthenaReadQueryFilter,
  type AthenaReadQueryOrder,
  normalizeAthenaReadQueryOrderBy,
} from "./read-query.ts";

export function descriptorFromReadQueryDefinition(
  definition: AthenaReadQueryDefinition,
  options?: {
    context?: AthenaCacheContextDescriptor;
    page?: number;
    pageSize?: number;
  }
): AthenaQueryDescriptor {
  const tableName = definition.schema
    ? `${definition.schema}.${definition.table}`
    : definition.table;
  const orders = normalizeAthenaReadQueryOrderBy(definition.orderBy);
  const primaryOrder = orders[0];
  const order: AthenaSortBy | undefined = primaryOrder
    ? {
        direction:
          primaryOrder.direction === "desc" ? "descending" : "ascending",
        field: primaryOrder.column,
      }
    : undefined;
  const conditions: AthenaGatewayCondition[] = (definition.filters ?? []).map(
    (filter: AthenaReadQueryFilter) => ({
      column: filter.column,
      operator: filter.operator ?? "eq",
      value: filter.value as AthenaGatewayCondition["value"],
    })
  );

  return compileAthenaQueryDescriptor({
    conditions,
    context: options?.context,
    currentPage: options?.page,
    limit: definition.limit,
    offset: undefined,
    operation: definition.mode === "select" ? "select" : "findMany",
    order,
    pageSize: options?.pageSize,
    projection: definition.columns.map((column) => column.column),
    tableName,
  });
}

export function readQueryDefinitionFromDescriptor(
  descriptor: AthenaQueryDescriptor
): AthenaReadQueryDefinition {
  const identityColumn = descriptor.dependency.fields.find((field) =>
    field.roles.includes("identity")
  )?.column;
  const columns = descriptor.projection?.star
    ? [{ column: "*", key: "*" }]
    : (descriptor.projection?.columns ?? []).map((column) => ({
        column,
        key: column,
      }));
  const orderBy: AthenaReadQueryOrder[] | undefined = descriptor.order?.map(
    (entry) => ({
      column: entry.column,
      direction: entry.ascending ? "asc" : "desc",
    })
  );

  return {
    columns: columns.length > 0 ? columns : [{ column: "*", key: "*" }],
    countColumn: identityColumn ?? columns[0]?.column ?? "id",
    filters: descriptor.filters?.map((filter) => ({
      column: filter.column ?? "",
      operator:
        filter.operator === "eq" ||
        filter.operator === "neq" ||
        filter.operator === "gt" ||
        filter.operator === "gte" ||
        filter.operator === "lt" ||
        filter.operator === "lte" ||
        filter.operator === "like" ||
        filter.operator === "ilike" ||
        filter.operator === "is" ||
        filter.operator === "in"
          ? filter.operator
          : "eq",
      value: filter.value as AthenaReadQueryDefinition["filters"] extends
        | readonly (infer T)[]
        | undefined
        ? T extends { value: infer V }
          ? V
          : never
        : never,
    })),
    limit: descriptor.range?.limit,
    mode: descriptor.operation === "select" ? "select" : "findMany",
    orderBy,
    schema: descriptor.target.schema,
    table: descriptor.target.table,
  };
}
