import type {
  AthenaSqliteBindValue,
  AthenaSqliteExecutionResult,
  AthenaSqliteStorageValue,
} from "./contracts.ts";

/** Runtime-only normalization at the host executor boundary. */
export function normalizeSqliteBindValue(value: unknown): AthenaSqliteBindValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array
  ) {
    return value;
  }
  return JSON.stringify(value) ?? null;
}

/** Validate and normalize host rows without defining query semantics. */
export function normalizeSqliteExecutionResult(
  result: AthenaSqliteExecutionResult,
): AthenaSqliteExecutionResult {
  if (
    !Array.isArray(result.columns) ||
    !Array.isArray(result.rows) ||
    result.rows.some((row) => !Array.isArray(row))
  ) {
    throw new Error("SQLite executor returned an invalid result.");
  }
  const columns = result.columns.map(String);
  for (const [index, row] of result.rows.entries()) {
    if (row.length !== columns.length) {
      throw new Error(
        `SQLite executor returned row width ${row.length} at row ${index}; expected ${columns.length} columns.`,
      );
    }
  }
  const rows = result.rows.map(
    (row) =>
      row.map((value: AthenaSqliteStorageValue) =>
        value === undefined ? null : value,
      ) as AthenaSqliteStorageValue[],
  );
  return {
    columns,
    rows,
    ...(typeof result.changes === "number" && Number.isFinite(result.changes)
      ? { changes: result.changes }
      : {}),
  };
}
