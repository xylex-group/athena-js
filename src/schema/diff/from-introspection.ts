import {
  schemaIrFromIntrospection,
  schemaSnapshotFromIr,
} from "../ir/compatibility.ts";
import type { AthenaSchemaIr } from "../ir/document.ts";
import type { IntrospectionSnapshot } from "../types.ts";
import { normalizeSchemaSnapshot } from "./normalize.ts";
import type { AthenaSchemaSnapshot } from "./types.ts";

/**
 * Athena bookkeeping schema excluded from managed-application diffs by default.
 * Verified against packages/athena-js/docs/migrations.md (`athena.schema_migrations`).
 */
export const ATHENA_INTERNAL_SCHEMAS = new Set(["athena", "athena_internal"]);

export interface SchemaSnapshotFromIntrospectionOptions {
  /** Drop Athena internal namespaces (default true). */
  readonly excludeInternal?: boolean;
  /**
   * Schema names to include. When omitted, all introspected schemas are kept
   * except {@link ATHENA_INTERNAL_SCHEMAS} when `excludeInternal` is true.
   */
  readonly schemas?: readonly string[];
}

/**
 * Public structural emit is {@link AthenaSchemaIr} via
 * {@link schemaIrFromIntrospection}. This helper is the lossy v1 projection.
 */
export function schemaSnapshotFromIntrospection(
  snapshot: IntrospectionSnapshot,
  options: SchemaSnapshotFromIntrospectionOptions = {}
): AthenaSchemaSnapshot {
  const ir: AthenaSchemaIr = schemaIrFromIntrospection(snapshot, {
    excludeInternal: options.excludeInternal,
    schemas: options.schemas,
  });
  return normalizeSchemaSnapshot(schemaSnapshotFromIr(ir));
}
