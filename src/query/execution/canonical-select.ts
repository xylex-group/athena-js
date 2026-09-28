import type { AthenaSelectQueryAst } from "../engine/ast.ts";
import { normalizeTransportPayload } from "../engine/index.ts";
import type { AthenaGatewayCondition, AthenaSortBy } from "../../gateway/types.ts";
import type { TableBuilderState } from "../contracts.ts";

export interface CanonicalSelectInput {
  columns: string | string[];
  state: TableBuilderState;
  tableName: string;
}

export interface CanonicalSelect {
  ast: AthenaSelectQueryAst;
}

function hasUnsupportedCondition(state: TableBuilderState): boolean {
  return (
    state.conditions.some(
      (condition) =>
        ["or", "not"].includes(condition.operator.toLowerCase()) ||
        condition.column_cast !== undefined ||
        condition.eq_column_cast !== undefined ||
        condition.value_cast !== undefined ||
        condition.eq_value_cast !== undefined
    ) || state.totalPages !== undefined
  );
}

function toLegacyPayload(input: CanonicalSelectInput): {
  columns: string | string[];
  conditions?: AthenaGatewayCondition[];
  current_page?: number;
  limit?: number;
  offset?: number;
  page_size?: number;
  sort_by?: AthenaSortBy;
  table_name: string;
  total_pages?: number;
} {
  return {
    columns: input.columns,
    conditions: input.state.conditions.length
      ? input.state.conditions
      : undefined,
    current_page: input.state.currentPage,
    limit: input.state.limit,
    offset: input.state.offset,
    page_size: input.state.pageSize,
    sort_by: input.state.order,
    table_name: input.tableName,
    total_pages: input.state.totalPages,
  };
}

/**
 * Lift lossless fluent state into the canonical AST before transport selection.
 * Unsupported legacy expressions deliberately return no result so the
 * compatibility compiler remains the explicit fallback.
 */
export function createCanonicalSelect(
  input: CanonicalSelectInput
): CanonicalSelect | undefined {
  if (
    input.state.relations?.length ||
    hasUnsupportedCondition(input.state)
  ) {
    return;
  }
  const ast = normalizeTransportPayload(toLegacyPayload(input));
  return {
    ast,
  };
}
