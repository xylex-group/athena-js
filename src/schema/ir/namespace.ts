import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaTable } from "./table.ts";

/** First-class enum object; columns reference it by id. */
export interface SchemaEnum {
	readonly id: SchemaObjectId;
	readonly identity: SchemaObjectIdentity;
	readonly labels: readonly string[];
	readonly name?: string | null;
}

export interface SchemaNamespace {
	readonly id: SchemaObjectId;
	readonly identity: SchemaObjectIdentity;
	readonly tables: readonly SchemaTable[];
	readonly enums?: readonly SchemaEnum[];
}
