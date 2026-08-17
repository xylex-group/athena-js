import type {
  AthenaStorageDirectUploadConfig,
  AthenaStoragePutBody,
} from "./module.ts";
import { canUseStorageXhrPut, putStorageBodyWithXhr } from "./xhr-put.ts";

interface DirectUploadProgress {
  loaded: number;
}

const SERVICE = "s3";
const TERMINATOR = "aws4_request";

export async function putDirectStorageUploadBody(
  config: AthenaStorageDirectUploadConfig,
  bucket: string | undefined,
  storageKey: string,
  body: AthenaStoragePutBody,
  uploadHeaders: Record<string, string>,
  signal: AbortSignal | undefined,
  onProgress: (progress: DirectUploadProgress) => void
): Promise<Response> {
  if (config.bucket && bucket && config.bucket !== bucket) {
    throw new Error(
      `athena.storage.file.upload direct mode bucket mismatch: configured ${config.bucket} but Athena returned ${bucket}`
    );
  }
  const target = createDirectUploadTarget(config, bucket, storageKey);
  const bytes = await bodyToArrayBuffer(body);
  const payloadHash = await sha256Hex(bytes);
  const headers = new Headers(uploadHeaders);
  if (isBlobBody(body) && body.type && !headers.has("Content-Type")) {
    headers.set("Content-Type", body.type);
  }

  const signed = await signDirectUploadRequest(
    config,
    target,
    headers,
    payloadHash
  );
  if (canUseStorageXhrPut()) {
    return putStorageBodyWithXhr({
      body,
      completeLoaded: bodySize(body),
      headers: signed.requestHeaders,
      onProgress,
      operationLabel: "athena.storage.file.upload",
      signal,
      url: target.toString(),
    });
  }

  onProgress({ loaded: 0 });
  const response = await fetch(target, {
    body: body as RequestInit["body"],
    headers: signed.requestHeaders,
    method: "PUT",
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `athena.storage.file.upload failed with status ${response.status}`
    );
  }
  onProgress({ loaded: bytes.byteLength });
  return response;
}

function createDirectUploadTarget(
  config: AthenaStorageDirectUploadConfig,
  bucket: string | undefined,
  storageKey: string
): URL {
  const resolvedBucket = config.bucket ?? bucket;
  if (!resolvedBucket?.trim()) {
    throw new Error(
      "athena.storage.file.upload direct mode requires a bucket in storage.directUpload or the server upload response"
    );
  }
  if (!storageKey.trim()) {
    throw new Error(
      "athena.storage.file.upload direct mode requires a storage key"
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint);
  } catch (error) {
    throw new Error(
      `athena.storage.file.upload direct mode received an invalid endpoint: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error(
      "athena.storage.file.upload direct mode endpoint must not contain a query or hash"
    );
  }

  const endpointPath = endpoint.pathname.replace(/\/+$/, "");
  const pathParts =
    config.forcePathStyle === false
      ? [endpointPath, storageKey]
      : [endpointPath, resolvedBucket, storageKey];
  if (config.forcePathStyle === false) {
    endpoint.hostname = `${resolvedBucket}.${endpoint.hostname}`;
  }
  endpoint.pathname = pathParts
    .filter(Boolean)
    .flatMap((part) => part.split("/"))
    .map(awsEncode)
    .join("/")
    .replace(/^([^/])/, "/$1");
  return endpoint;
}

async function signDirectUploadRequest(
  config: AthenaStorageDirectUploadConfig,
  target: URL,
  inputHeaders: Headers,
  payloadHash: string
): Promise<{ requestHeaders: Record<string, string> }> {
  const accessKeyId = config.accessKeyId.trim();
  const secretAccessKey = config.secretAccessKey.trim();
  if (!(accessKeyId && secretAccessKey)) {
    throw new Error(
      "athena.storage.file.upload direct mode requires accessKeyId and secretAccessKey"
    );
  }

  const now = new Date();
  const amzDate = formatAmzDate(now);
  const shortDate = amzDate.slice(0, 8);
  const region = config.region?.trim() || "auto";
  const headers: Record<string, string> = {};
  inputHeaders.forEach((value, key) => {
    if (key.toLowerCase() !== "authorization" && key.toLowerCase() !== "host") {
      headers[key.toLowerCase()] = value.trim().replace(/\s+/g, " ");
    }
  });
  headers["x-amz-content-sha256"] = payloadHash;
  headers["x-amz-date"] = amzDate;
  if (config.sessionToken?.trim()) {
    headers["x-amz-security-token"] = config.sessionToken.trim();
  }

  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}\n`)
    .join("");
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalRequest = [
    "PUT",
    target.pathname,
    "",
    `host:${target.host}\n${canonicalHeaders}`,
    `host;${signedHeaders}`,
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${SERVICE}/${TERMINATOR}`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const dateKey = await hmac(`AWS4${secretAccessKey}`, shortDate);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, SERVICE);
  const signingKey = await hmac(serviceKey, TERMINATOR);
  const signature = await hmacHex(signingKey, stringToSign);
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=host;${signedHeaders}, Signature=${signature}`;

  return { requestHeaders: headers };
}

function isBlobBody(body: AthenaStoragePutBody): body is Blob {
  return typeof Blob !== "undefined" && body instanceof Blob;
}

async function bodyToArrayBuffer(
  body: AthenaStoragePutBody
): Promise<ArrayBuffer> {
  if (isBlobBody(body)) {
    return body.arrayBuffer();
  }
  if (body instanceof ArrayBuffer) {
    return body;
  }
  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(
      body.byteOffset,
      body.byteOffset + body.byteLength
    ) as ArrayBuffer;
  }
  throw new Error(
    "athena.storage.file.upload direct mode does not support ReadableStream bodies"
  );
}

function bodySize(body: AthenaStoragePutBody): number {
  if (isBlobBody(body)) {
    return body.size;
  }
  if (body instanceof ArrayBuffer) {
    return body.byteLength;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  return 0;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function formatAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

async function sha256Hex(value: string | ArrayBuffer): Promise<string> {
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(digest));
}

async function hmac(
  key: string | ArrayBuffer,
  value: string
): Promise<ArrayBuffer> {
  const keyBytes =
    typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value));
}

async function hmacHex(key: ArrayBuffer, value: string): Promise<string> {
  return toHex(new Uint8Array(await hmac(key, value)));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}
