import type { AthenaRelationCardinality } from "./relations.ts";

export type AthenaRelationSelection = "natural" | "first";
export type AthenaRelationResultShape = "many" | "at-most-one";

export function relationResultShape(
  cardinality: AthenaRelationCardinality,
  selection: AthenaRelationSelection
): AthenaRelationResultShape {
  if (selection === "first") {
    return "at-most-one";
  }
  return cardinality === "one-to-many" || cardinality === "many-to-many"
    ? "many"
    : "at-most-one";
}

export function atMostOneSqlLimit(limit?: number): number {
  return Math.min(Math.max(0, Math.trunc(limit ?? 1)), 1);
}
