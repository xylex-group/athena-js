import type { SchemaDatabase } from "./database.ts";
import type { SchemaMetadata } from "./metadata.ts";
import type { AthenaSchemaIrVersion } from "./version.ts";
import { ATHENA_SCHEMA_IR_KIND, ATHENA_SCHEMA_IR_VERSION } from "./version.ts";

/**
 * Canonical versioned structural document (`kind: "athena.schema"`).
 * Everything that describes database structure normalizes into this shape.
 */
export interface AthenaSchemaIr {
  readonly databases: readonly SchemaDatabase[];
  readonly irVersion: AthenaSchemaIrVersion;
  readonly kind: "athena.schema";
  readonly metadata: SchemaMetadata;
}

export function emptyAthenaSchemaIr(
  metadata: SchemaMetadata = {}
): AthenaSchemaIr {
  return {
    databases: [],
    irVersion: ATHENA_SCHEMA_IR_VERSION,
    kind: ATHENA_SCHEMA_IR_KIND,
    metadata,
  };
}
