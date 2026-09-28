export type SchemaIrProvenanceSource =
  | "models"
  | "introspection"
  | "fixture"
  | "snapshot"
  | "table"
  | string;

export interface SchemaIrProvenance {
  readonly backend?: string | null;
  readonly generatedAt?: string;
  readonly generator?: string;
  readonly source?: SchemaIrProvenanceSource;
}

/**
 * Document metadata / extensions / provenance (Policy IR analog).
 * Fingerprint MUST exclude this object.
 */
export interface SchemaMetadata {
  readonly extensions?: Readonly<Record<string, unknown>>;
  readonly provenance?: SchemaIrProvenance;
}
