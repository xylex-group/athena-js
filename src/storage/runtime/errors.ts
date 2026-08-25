import type { StorageObjectResult } from "./types.ts";

export function storageErrorResult(
	errorNumber: number,
	code: string,
	message: string,
	status: number,
): StorageObjectResult {
	return {
		error: { code, errorNumber, message },
		ok: false,
		status,
	};
}

export function storageOkResult(
	data: unknown,
	status = 200,
): StorageObjectResult {
	return { data, ok: true, status };
}

export function mapProviderFailure(error: unknown): StorageObjectResult {
	const message = error instanceof Error ? error.message : String(error);
	if (/not found/i.test(message)) {
		return storageErrorResult(3005, "storage_file_not_found", message, 404);
	}
	return storageErrorResult(3010, "storage_internal", message, 500);
}
