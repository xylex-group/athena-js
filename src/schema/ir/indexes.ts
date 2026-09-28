import type { SchemaObjectId } from "./identity.ts";

export interface SchemaIndexColumn {
  readonly direction?: "asc" | "desc" | null;
  readonly name: string;
}

export interface SchemaIndex {
  readonly columns: readonly SchemaIndexColumn[];
  readonly id: SchemaObjectId;
  readonly method?: string | null;
  readonly name?: string | null;
  readonly predicate?: string | null;
  readonly unique: boolean;
}
