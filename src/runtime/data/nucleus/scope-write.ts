import type { AthenaGatewayCondition } from "../../../gateway/types.ts";

export interface AthenaScopeWriteConflict {
  actual?: string;
  column: string;
  expected: string;
}

export type AthenaScopeWriteResult =
  | { ok: true; payload: unknown }
  | { conflict: AthenaScopeWriteConflict; ok: false };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item)
    );
  }
  const row = asRecord(value);
  return row ? [row] : [];
}

function normalizeScopeValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
}

function readConditionColumn(condition: AthenaGatewayCondition): string | undefined {
  return (
    (typeof condition.column === "string" && condition.column) ||
    (typeof condition.eq_column === "string" && condition.eq_column) ||
    undefined
  );
}

function readConditionValue(condition: AthenaGatewayCondition): unknown {
  if (condition.value !== undefined) {
    return condition.value;
  }
  return condition.eq_value;
}

function pushScopeToken(tokens: Set<string>, value: unknown): void {
  const token = normalizeScopeValue(value);
  if (token) {
    tokens.add(token);
  }
}

function readConditionScopeValues(payload: unknown, column: string): Set<string> {
  const record = asRecord(payload);
  const tokens = new Set<string>();
  const conditions = record?.conditions;
  if (!Array.isArray(conditions)) {
    return tokens;
  }
  for (const condition of conditions) {
    if (!(condition && typeof condition === "object")) {
      continue;
    }
    const typed = condition as AthenaGatewayCondition;
    if (readConditionColumn(typed) !== column) {
      continue;
    }
    const value = readConditionValue(typed);
    if (Array.isArray(value)) {
      for (const item of value) {
        pushScopeToken(tokens, item);
      }
      continue;
    }
    pushScopeToken(tokens, value);
  }
  return tokens;
}

export function readDeclaredScopeValue(
  payload: unknown,
  column: string
): string | undefined {
  const record = asRecord(payload);
  if (!record) {
    return;
  }
  const tokens = readConditionScopeValues(record, column);
  for (const row of asRows(record.insert_body)) {
    if (Object.hasOwn(row, column)) {
      pushScopeToken(tokens, row[column]);
    }
  }
  for (const row of asRows(record.update_body)) {
    if (Object.hasOwn(row, column)) {
      pushScopeToken(tokens, row[column]);
    }
  }
  if (tokens.size === 1) {
    return tokens.values().next().value;
  }
}

export function hasConflictingScopeCondition(
  payload: unknown,
  column: string,
  expected: string
): boolean {
  const values = readConditionScopeValues(payload, column);
  if (values.size === 0) {
    return false;
  }
  if (values.size > 1) {
    return true;
  }
  return values.values().next().value !== expected;
}

export function applyInsertScopeBinding(
  payload: unknown,
  column: string,
  expected: string
): AthenaScopeWriteResult {
  const record = asRecord(payload);
  if (!record) {
    return { ok: true, payload };
  }
  const body = record.insert_body;
  const rows = asRows(body);
  if (rows.length === 0) {
    return { ok: true, payload };
  }
  const nextRows: Record<string, unknown>[] = [];
  for (const row of rows) {
    const nextRow: Record<string, unknown> = { ...row };
    if (Object.hasOwn(nextRow, column) && nextRow[column] !== undefined) {
      const actual = normalizeScopeValue(nextRow[column]);
      if (actual !== expected) {
        return {
          conflict: {
            actual,
            column,
            expected,
          },
          ok: false,
        };
      }
    } else {
      nextRow[column] = expected;
    }
    nextRows.push(nextRow);
  }
  const nextBody = Array.isArray(body) ? nextRows : nextRows[0];
  return {
    ok: true,
    payload: {
      ...record,
      insert_body: nextBody,
    },
  };
}

export function enforceUpdateScopeImmutable(
  payload: unknown,
  column: string,
  expected: string
): AthenaScopeWriteResult {
  const record = asRecord(payload);
  if (!record) {
    return { ok: true, payload };
  }
  const updateBody = asRecord(record.update_body);
  if (!updateBody) {
    return { ok: true, payload };
  }
  if (!(Object.hasOwn(updateBody, column) && updateBody[column] !== undefined)) {
    return { ok: true, payload };
  }
  const actual = normalizeScopeValue(updateBody[column]);
  if (actual !== expected) {
    return {
      conflict: {
        actual,
        column,
        expected,
      },
      ok: false,
    };
  }
  return { ok: true, payload };
}
