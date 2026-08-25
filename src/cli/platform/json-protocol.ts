import { CLI_JSON_SCHEMA_VERSION } from "./constants.ts";
import type { CliDiagnostic } from "./result.ts";

export interface CliJsonErrorBody {
	code: string;
	message: string;
	hint?: string;
	details?: Record<string, unknown>;
}

export interface CliJsonSuccess<T = unknown> {
	schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
	command: string;
	ok: true;
	data: T;
	warnings?: CliDiagnostic[];
	meta?: {
		durationMs: number;
	};
}

export interface CliJsonFailure {
	schemaVersion: typeof CLI_JSON_SCHEMA_VERSION;
	command: string;
	ok: false;
	error: CliJsonErrorBody;
}

export type CliJsonEnvelope<T = unknown> = CliJsonSuccess<T> | CliJsonFailure;

export function encodeCliJsonSuccess<T>(
	command: string,
	data: T,
	options: { durationMs?: number; warnings?: CliDiagnostic[] } = {},
): CliJsonSuccess<T> {
	const envelope: CliJsonSuccess<T> = {
		schemaVersion: CLI_JSON_SCHEMA_VERSION,
		command,
		ok: true,
		data,
	};
	if (options.warnings && options.warnings.length > 0) {
		envelope.warnings = options.warnings;
	}
	if (options.durationMs !== undefined) {
		envelope.meta = { durationMs: options.durationMs };
	}
	return envelope;
}

export function encodeCliJsonFailure(
	command: string,
	error: CliJsonErrorBody,
): CliJsonFailure {
	return {
		schemaVersion: CLI_JSON_SCHEMA_VERSION,
		command,
		ok: false,
		error,
	};
}

export function stringifyCliJson(envelope: CliJsonEnvelope): string {
	return JSON.stringify(envelope, null, 2);
}
