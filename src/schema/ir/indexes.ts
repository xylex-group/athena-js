import type { SchemaObjectId } from "./identity.ts";

export interface SchemaIndexColumn {
	readonly name: string;
	readonly direction?: "asc" | "desc" | null;
}

export interface SchemaIndex {
	readonly id: SchemaObjectId;
	readonly columns: readonly SchemaIndexColumn[];
	readonly unique: boolean;
	readonly name?: string | null;
	readonly predicate?: string | null;
	readonly method?: string | null;
}
