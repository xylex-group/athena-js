import {
	schemaIrFromModels,
	schemaSnapshotFromIr,
} from "../ir/compatibility.ts";
import type { AthenaSchemaIr } from "../ir/document.ts";
import type { ModelSqlInput } from "../model-sql.ts";
import { normalizeSchemaSnapshot } from "./normalize.ts";
import type { AthenaSchemaSnapshot } from "./types.ts";

export interface SchemaSnapshotFromModelsOptions {
	/** Backend label stored on the snapshot (default `postgresql`). */
	readonly backend?: string | null;
	/** Default schema when model metadata omits schema (default `public`). */
	readonly defaultSchema?: string;
}

/**
 * Public structural emit is {@link AthenaSchemaIr} via {@link schemaIrFromModels}.
 * This helper remains the lossy v1 compatibility projection.
 */
export function schemaSnapshotFromModels(
	input: ModelSqlInput,
	options: SchemaSnapshotFromModelsOptions = {},
): AthenaSchemaSnapshot {
	const ir: AthenaSchemaIr = schemaIrFromModels(input, options);
	return normalizeSchemaSnapshot(schemaSnapshotFromIr(ir));
}
