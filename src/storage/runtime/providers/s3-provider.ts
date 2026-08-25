import {
	mapProviderFailure,
	storageErrorResult,
	storageOkResult,
} from "../errors.ts";
import type {
	AuthorizedStorageOperation,
	StorageObjectProvider,
} from "../types.ts";

export interface AthenaS3ObjectClient {
	deleteObject(input: { Bucket: string; Key: string }): Promise<unknown>;
	getObject(input: { Bucket: string; Key: string }): Promise<{
		Body?: unknown;
		ContentLength?: number;
		ContentType?: string;
		ETag?: string;
		Metadata?: Record<string, string>;
	}>;
	headObject(input: { Bucket: string; Key: string }): Promise<{
		ContentLength?: number;
		ContentType?: string;
		ETag?: string;
		Metadata?: Record<string, string>;
	}>;
	listObjectsV2(input: {
		Bucket: string;
		ContinuationToken?: string;
		MaxKeys?: number;
		Prefix?: string;
	}): Promise<{
		Contents?: Array<{
			ETag?: string;
			Key?: string;
			LastModified?: Date;
			Size?: number;
		}>;
		IsTruncated?: boolean;
		NextContinuationToken?: string;
	}>;
	putObject(input: {
		Body?: Uint8Array;
		Bucket: string;
		ContentType?: string;
		Key: string;
		Metadata?: Record<string, string>;
	}): Promise<unknown>;
}

export function isAthenaS3ObjectClient(
	value: unknown,
): value is AthenaS3ObjectClient {
	if (!value || typeof value !== "object") {
		return false;
	}
	const client = value as Record<string, unknown>;
	return (
		typeof client.getObject === "function" &&
		typeof client.putObject === "function" &&
		typeof client.headObject === "function" &&
		typeof client.deleteObject === "function" &&
		typeof client.listObjectsV2 === "function"
	);
}

export function createS3StorageProvider(options: {
	bucket: string;
	prefix?: string | null;
	s3: AthenaS3ObjectClient;
}): StorageObjectProvider {
	const bucket = options.bucket.trim();
	const prefix = normalizePrefix(options.prefix);
	const { s3 } = options;
	return {
		async execute(op: AuthorizedStorageOperation) {
			try {
				switch (op.op) {
					case "put": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"put requires key",
								400,
							);
						}
						const key = toPhysicalKey(prefix, op.key);
						await s3.putObject({
							Body: op.body ?? new Uint8Array(),
							Bucket: bucket,
							ContentType: op.contentType,
							Key: key,
							Metadata: op.metadata,
						});
						return storageOkResult({ key: toLogicalKey(prefix, key) });
					}
					case "get": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"get requires key",
								400,
							);
						}
						const result = await s3.getObject({
							Bucket: bucket,
							Key: toPhysicalKey(prefix, op.key),
						});
						return storageOkResult(await readS3Body(result.Body));
					}
					case "head": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"head requires key",
								400,
							);
						}
						const result = await s3.headObject({
							Bucket: bucket,
							Key: toPhysicalKey(prefix, op.key),
						});
						return storageOkResult({
							contentType: result.ContentType,
							etag: result.ETag,
							key: op.key,
							metadata: result.Metadata,
							size: result.ContentLength ?? 0,
						});
					}
					case "delete": {
						if (!op.key?.trim()) {
							return storageErrorResult(
								3000,
								"storage_invalid_request",
								"delete requires key",
								400,
							);
						}
						const key = toPhysicalKey(prefix, op.key);
						await s3.deleteObject({ Bucket: bucket, Key: key });
						return storageOkResult({
							deleted: [toLogicalKey(prefix, key)],
						});
					}
					case "list": {
						const listPrefix = joinPrefix(prefix, op.prefix);
						const result = await s3.listObjectsV2({
							Bucket: bucket,
							ContinuationToken: op.cursor,
							MaxKeys: op.limit,
							Prefix: listPrefix || undefined,
						});
						const objects = (result.Contents ?? [])
							.filter((entry) => typeof entry.Key === "string")
							.map((entry) => ({
								etag: entry.ETag,
								key: toLogicalKey(prefix, entry.Key as string),
								size: entry.Size ?? 0,
								uploaded: entry.LastModified,
							}));
						return storageOkResult({
							cursor: result.NextContinuationToken,
							objects,
							truncated: Boolean(result.IsTruncated),
						});
					}
					default:
						return storageErrorResult(
							3000,
							"storage_invalid_request",
							`unsupported op ${String(op.op)}`,
							400,
						);
				}
			} catch (error) {
				return mapS3Failure(error);
			}
		},
	};
}

function normalizePrefix(prefix: string | null | undefined): string {
	if (!prefix?.trim()) {
		return "";
	}
	const normalized = prefix.replace(/^\/+/, "").replace(/\/?$/, "/");
	if (normalized.includes("\0") || normalized.split("/").includes("..")) {
		throw new Error("storage prefix must not contain null bytes or .. segments");
	}
	return normalized;
}

function assertSafeObjectKey(key: string): string {
	if (!key.trim()) {
		throw new Error("Object key is required");
	}
	if (key.includes("\0")) {
		throw new Error("Object key must not contain null bytes");
	}
	const cleaned = key.replace(/^\/+/, "");
	if (!cleaned) {
		throw new Error("Object key is required");
	}
	if (cleaned.split("/").includes("..")) {
		throw new Error('Object key must not contain ".." path segments');
	}
	return cleaned;
}

function toPhysicalKey(prefix: string, key: string): string {
	return `${prefix}${assertSafeObjectKey(key)}`;
}

function toLogicalKey(prefix: string, physicalKey: string): string {
	if (prefix && physicalKey.startsWith(prefix)) {
		return physicalKey.slice(prefix.length);
	}
	return physicalKey;
}

function joinPrefix(base: string, extra?: string): string {
	if (!extra?.trim()) {
		return base;
	}
	return `${base}${extra.replace(/^\/+/, "")}`;
}

async function readS3Body(body: unknown): Promise<Uint8Array> {
	if (body == null) {
		return new Uint8Array();
	}
	if (body instanceof Uint8Array) {
		return body;
	}
	if (typeof body === "string") {
		return new TextEncoder().encode(body);
	}
	if (typeof body === "object") {
		const record = body as {
			arrayBuffer?: () => Promise<ArrayBuffer>;
			transformToByteArray?: () => Promise<Uint8Array | ArrayBuffer>;
			transformToString?: () => Promise<string>;
		};
		if (typeof record.transformToByteArray === "function") {
			return new Uint8Array(await record.transformToByteArray());
		}
		if (typeof record.arrayBuffer === "function") {
			return new Uint8Array(await record.arrayBuffer());
		}
		if (typeof record.transformToString === "function") {
			return new TextEncoder().encode(await record.transformToString());
		}
	}
	return new Uint8Array();
}

function mapS3Failure(error: unknown): ReturnType<typeof storageErrorResult> {
	const code = s3ErrorCode(error).toLowerCase();
	const status = s3HttpStatus(error);
	if (
		status === 404 ||
		code === "nosuchkey" ||
		code === "notfound" ||
		code === "nosuchbucket"
	) {
		const message = error instanceof Error ? error.message : String(error);
		return storageErrorResult(3005, "storage_file_not_found", message, 404);
	}
	if (status === 400 || code === "invalidargument" || code === "invalidbucketname") {
		const message = error instanceof Error ? error.message : String(error);
		return storageErrorResult(3000, "storage_invalid_request", message, 400);
	}
	return mapProviderFailure(error);
}

function s3ErrorCode(error: unknown): string {
	if (!error || typeof error !== "object") {
		return "";
	}
	const record = error as { Code?: string; code?: string; name?: string };
	return String(record.Code ?? record.code ?? record.name ?? "");
}

function s3HttpStatus(error: unknown): number | undefined {
	if (!error || typeof error !== "object") {
		return undefined;
	}
	return (error as { $metadata?: { httpStatusCode?: number } }).$metadata
		?.httpStatusCode;
}
