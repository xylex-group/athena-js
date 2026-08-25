import type { SchemaColumn } from "./column.ts";
import type { SchemaConstraint } from "./constraint.ts";
import type { SchemaObjectId, SchemaObjectIdentity } from "./identity.ts";
import type { SchemaIndex } from "./indexes.ts";
import type { SchemaRelation } from "./relation.ts";

export interface SchemaTable {
  readonly id: SchemaObjectId;
  readonly identity: SchemaObjectIdentity;
  readonly columns: readonly SchemaColumn[];
  readonly constraints: readonly SchemaConstraint[];
  readonly relations: readonly SchemaRelation[];
  readonly indexes: readonly SchemaIndex[];
}
