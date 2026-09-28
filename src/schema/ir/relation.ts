import type { SchemaObjectId } from "./identity.ts";

export type SchemaRelationCardinality = "1:1" | "1:n" | "n:1" | "n:n";

export interface SchemaRelationThrough {
  readonly sourceColumns: readonly string[];
  readonly tableId: SchemaObjectId | string;
  readonly targetColumns: readonly string[];
}

/**
 * Semantic relation, distinct from FK {@link SchemaConstraint} rows.
 * Cardinalities: 1:1, 1:n, n:1, n:n. Optional through + backingConstraintIds.
 */
export interface SchemaRelation {
  readonly backingConstraintIds: readonly string[];
  readonly cardinality: SchemaRelationCardinality;
  readonly id: SchemaObjectId;
  readonly name?: string | null;
  readonly sourceColumns?: readonly string[];
  readonly sourceTableId: SchemaObjectId | string;
  readonly targetColumns?: readonly string[];
  readonly targetTableId: SchemaObjectId | string;
  readonly through?: SchemaRelationThrough;
}
