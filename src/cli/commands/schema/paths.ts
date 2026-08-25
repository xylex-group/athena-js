import { join } from "node:path";

export const DEFAULT_SCHEMA_SNAPSHOT_PATH = "athena/schema.snapshot.json";

export function resolveSchemaSnapshotPath(
	cwd: string,
	explicit?: string,
): string {
	if (!explicit) {
		return join(cwd, DEFAULT_SCHEMA_SNAPSHOT_PATH);
	}
	if (explicit.startsWith("/") || /^[A-Za-z]:[\\/]/.test(explicit)) {
		return explicit;
	}
	return join(cwd, explicit);
}
