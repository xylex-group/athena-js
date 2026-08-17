import type { AthenaModelTarget } from "../schema/types.ts";
import { canonicalizeAthenaValue } from "./canonicalize.ts";
import type { AthenaCacheScope } from "./descriptor.ts";
import { resolveAthenaQueryTarget } from "./descriptor.ts";

export type AthenaPrimaryKey = readonly (readonly [string, unknown])[];

export interface AthenaModelIdentity {
  database?: string;
  model?: string;
  schema?: string;
  table: string;
}

export type AthenaEntityContextIdentity = AthenaCacheScope | null;

export interface AthenaEntityKey {
  context: AthenaEntityContextIdentity;
  model: AthenaModelIdentity;
  primaryKey: AthenaPrimaryKey;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readRowField(row: Record<string, unknown>, column: string): unknown {
  if (column in row) {
    return row[column];
  }
  return;
}

export function modelIdentity(
  model: AthenaModelTarget,
  row: unknown
): AthenaPrimaryKey {
  const columns = model.meta.primaryKey;
  if (!columns.length) {
    throw new Error(
      "modelIdentity: model has no primary key. Full-row normalization requires meta.primaryKey."
    );
  }
  if (!isRecord(row)) {
    throw new Error("modelIdentity: row must be an object.");
  }
  const pairs: Array<readonly [string, unknown]> = [];
  for (const column of columns) {
    const value = readRowField(row, column);
    if (value === undefined) {
      throw new Error(`modelIdentity: missing primary key field "${column}".`);
    }
    pairs.push([column, value]);
  }
  return pairs;
}

export function createAthenaEntityKey(
  model: AthenaModelTarget,
  row: unknown,
  context?: AthenaCacheScope
): AthenaEntityKey {
  const target = resolveAthenaQueryTarget(
    model.meta.tableName ?? model.meta.model ?? "",
    model
  );
  if (!target.table) {
    throw new Error(
      "createAthenaEntityKey: model is missing table identity (meta.tableName or meta.model)."
    );
  }
  return {
    context: context ?? null,
    model: {
      database: target.database,
      model: target.model,
      schema: target.schema,
      table: target.table,
    },
    primaryKey: modelIdentity(model, row),
  };
}

export function athenaEntityKeyToken(key: AthenaEntityKey): string {
  const qualified = key.model.schema
    ? `${key.model.schema}.${key.model.table}`
    : key.model.table;
  const pk = key.primaryKey
    .map(([column, value]) => `${column}=${stablePrimitive(value)}`)
    .join("&");
  const context = key.context
    ? [
        `org=${key.context.organizationId ?? ""}`,
        `user=${key.context.userId ?? ""}`,
        `access=${key.context.accessScope ?? ""}`,
        `policy=${key.context.policyRevision ?? ""}`,
      ].join("|")
    : "";
  return `entity:${key.model.database ?? ""}:${qualified}:${context}:${pk}`;
}

function stablePrimitive(value: unknown): string {
  return canonicalizeAthenaValue(value);
}

export function entityKeyFromSinglePrimary(
  model: AthenaModelTarget,
  id: unknown,
  context?: AthenaCacheScope
): AthenaEntityKey {
  const columns = model.meta.primaryKey;
  if (columns.length !== 1) {
    throw new Error(
      "entityKeyFromSinglePrimary: model does not have a single-column primary key."
    );
  }
  return createAthenaEntityKey(model, { [columns[0] as string]: id }, context);
}
