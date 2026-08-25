export type SchemaIrProvenanceSource =
	| "models"
	| "introspection"
	| "fixture"
	| "snapshot"
	| "table"
	| string;

export interface SchemaIrProvenance {
	readonly source?: SchemaIrProvenanceSource;
	readonly generatedAt?: string;
	readonly generator?: string;
	readonly backend?: string | null;
}

/**
 * Document metadata / extensions / provenance (Policy IR analog).
 * Fingerprint MUST exclude this object.
 */
export interface SchemaMetadata {
	readonly provenance?: SchemaIrProvenance;
	readonly extensions?: Readonly<Record<string, unknown>>;
}
