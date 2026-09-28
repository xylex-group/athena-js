/**
 * Stable result compatibility barrel.
 *
 * Result ownership lives under result/; this path remains for existing imports.
 */
export type {
  AthenaResult,
  AthenaResultError,
  AthenaResultFormatter,
} from "./result/types.ts";
export {
  applyCardinality,
  toSingleResult,
} from "./result/cardinality.ts";
export type { AthenaCardinalityMode } from "./result/cardinality.ts";
export { executeRead } from "./result/read.ts";
export { createResultFormatter } from "./result/formatter.ts";
