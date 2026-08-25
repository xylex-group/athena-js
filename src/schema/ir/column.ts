import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaType } from "./type.ts";

export interface SchemaColumn {
	readonly id: SchemaObjectId;
	readonly identity: SchemaObjectIdentity;
	readonly type: SchemaType;
	readonly nullable: boolean;
	readonly default?: string | null;
	readonly generated?: boolean;
}
