import type { SchemaObjectId } from "./identity.ts";

export type SchemaReferentialAction =
	| "no_action"
	| "restrict"
	| "cascade"
	| "set_null"
	| "set_default";

export interface SchemaPrimaryKeyConstraint {
	readonly id: SchemaObjectId;
	readonly kind: "primary_key";
	readonly columns: readonly string[];
	readonly name?: string | null;
}

export interface SchemaUniqueConstraint {
	readonly id: SchemaObjectId;
	readonly kind: "unique";
	readonly columns: readonly string[];
	readonly name?: string | null;
}

export interface SchemaForeignKeyConstraint {
	readonly id: SchemaObjectId;
	readonly kind: "foreign_key";
	readonly columns: readonly string[];
	readonly targetTableId: SchemaObjectId | string;
	readonly targetColumns: readonly string[];
	readonly name?: string | null;
	readonly onDelete?: SchemaReferentialAction;
	readonly onUpdate?: SchemaReferentialAction;
}

export interface SchemaCheckConstraint {
	readonly id: SchemaObjectId;
	readonly kind: "check";
	readonly expression: string;
	readonly name?: string | null;
}

/** First-class table constraint including CHECK, with a stable id. */
export type SchemaConstraint =
	| SchemaPrimaryKeyConstraint
	| SchemaUniqueConstraint
	| SchemaForeignKeyConstraint
	| SchemaCheckConstraint;
