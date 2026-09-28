import type { SchemaObjectId } from "./identity.ts";

export type SchemaReferentialAction =
  | "no_action"
  | "restrict"
  | "cascade"
  | "set_null"
  | "set_default";

export interface SchemaPrimaryKeyConstraint {
  readonly columns: readonly string[];
  readonly id: SchemaObjectId;
  readonly kind: "primary_key";
  readonly name?: string | null;
}

export interface SchemaUniqueConstraint {
  readonly columns: readonly string[];
  readonly id: SchemaObjectId;
  readonly kind: "unique";
  readonly name?: string | null;
}

export interface SchemaForeignKeyConstraint {
  readonly columns: readonly string[];
  readonly id: SchemaObjectId;
  readonly kind: "foreign_key";
  readonly name?: string | null;
  readonly onDelete?: SchemaReferentialAction;
  readonly onUpdate?: SchemaReferentialAction;
  readonly targetColumns: readonly string[];
  readonly targetTableId: SchemaObjectId | string;
}

export interface SchemaCheckConstraint {
  readonly expression: string;
  readonly id: SchemaObjectId;
  readonly kind: "check";
  readonly name?: string | null;
}

/** First-class table constraint including CHECK, with a stable id. */
export type SchemaConstraint =
  | SchemaPrimaryKeyConstraint
  | SchemaUniqueConstraint
  | SchemaForeignKeyConstraint
  | SchemaCheckConstraint;
