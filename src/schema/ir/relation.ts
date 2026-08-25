import type { SchemaObjectId } from "./identity.ts";

export type SchemaRelationCardinality = "1:1" | "1:n" | "n:1" | "n:n";

export interface SchemaRelationThrough {
  readonly tableId: SchemaObjectId | string;
  readonly sourceColumns: readonly string[];
  readonly targetColumns: readonly string[];
}

/**
 * Semantic relation, distinct from FK {@link SchemaConstraint} rows.
 * Cardinalities: 1:1, 1:n, n:1, n:n. Optional through + backingConstraintIds.
 */
export interface SchemaRelation {
  readonly id: SchemaObjectId;
  readonly cardinality: SchemaRelationCardinality;
  readonly sourceTableId: SchemaObjectId | string;
  readonly targetTableId: SchemaObjectId | string;
  readonly sourceColumns?: readonly string[];
  readonly targetColumns?: readonly string[];
  readonly through?: SchemaRelationThrough;
  readonly backingConstraintIds: readonly string[];
  readonly name?: string | null;
}
