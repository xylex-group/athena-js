import type {
  SchemaForeignKey,
  SchemaIndex,
  SchemaTableIdentity,
  SchemaUniqueConstraint,
} from "./types.ts";

/** Stable map key for a schema-qualified table. */
export function tableIdentityKey(identity: SchemaTableIdentity): string {
  return `${identity.schema}\u0000${identity.name}`;
}

export function tableIdentityKeyParts(schema: string, name: string): string {
  return tableIdentityKey({ schema, name });
}

/** Structural unique key: ordered columns (names ignored). */
export function uniqueStructuralKey(
  unique: Pick<SchemaUniqueConstraint, "columns">
): string {
  return `u:${unique.columns.join("\u0000")}`;
}

/** Structural FK key: columns + target + target columns + actions. */
export function foreignKeyStructuralKey(
  fk: Pick<
    SchemaForeignKey,
    "columns" | "target" | "targetColumns" | "onDelete" | "onUpdate"
  >
): string {
  return [
    "fk",
    fk.columns.join(","),
    tableIdentityKey(fk.target),
    fk.targetColumns.join(","),
    fk.onDelete,
    fk.onUpdate,
  ].join("\u0000");
}

/**
 * Structural FK identity for match-before-alter (columns + target only).
 * Referential action changes become alter_foreign_key, not drop+add.
 */
export interface ForeignKeyMatchKeyInput {
  readonly columns: readonly string[];
  readonly target: SchemaTableIdentity;
  readonly targetColumns: readonly string[];
}

export function foreignKeyMatchKey(fk: ForeignKeyMatchKeyInput): string {
  return [
    "fkm",
    fk.columns.join(","),
    tableIdentityKey(fk.target),
    fk.targetColumns.join(","),
  ].join("\u0000");
}

/** Structural index key: unique flag + ordered columns + directions + predicate. */
export function indexStructuralKey(
  index: Pick<SchemaIndex, "columns" | "unique" | "predicate" | "method">
): string {
  const cols = index.columns
    .map((c) => `${c.name}:${c.direction ?? "asc"}`)
    .join(",");
  return [
    "ix",
    index.unique ? "1" : "0",
    cols,
    index.predicate ?? "",
    index.method ?? "",
  ].join("\u0000");
}

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareTableIdentity(
  a: SchemaTableIdentity,
  b: SchemaTableIdentity
): number {
  const schemaCmp = compareStrings(a.schema, b.schema);
  if (schemaCmp !== 0) {
    return schemaCmp;
  }
  return compareStrings(a.name, b.name);
}
