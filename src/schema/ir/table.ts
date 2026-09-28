import type { SchemaColumn } from "./column.ts";
import type { SchemaConstraint } from "./constraint.ts";
import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaIndex } from "./indexes.ts";
import type { SchemaRelation } from "./relation.ts";

export interface SchemaTable {
  readonly columns: readonly SchemaColumn[];
  readonly constraints: readonly SchemaConstraint[];
  readonly id: SchemaObjectId;
  readonly identity: SchemaObjectIdentity;
  readonly indexes: readonly SchemaIndex[];
  readonly relations: readonly SchemaRelation[];
}
