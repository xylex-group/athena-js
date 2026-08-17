import { AthenaGatewayError } from "./errors.ts";

export const ATHENA_DEFAULT_BASE_URL = "https://mirror2.athena-cluster.com";

function describeReceivedValue(value: unknown): string {
  if (value === undefined) {
    return "undefined";
  }
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return value.trim().length > 0 ? JSON.stringify(value) : "an empty string";
  }
  return `${typeof value} ${JSON.stringify(value)}`;
}

function invalidBaseUrlError(
  message: string,
  hint: string,
  cause?: unknown
): AthenaGatewayError {
  return new AthenaGatewayError({
    cause:
      cause instanceof Error
        ? cause.message
        : cause === undefined || cause === null
          ? undefined
          : String(cause),
    code: "INVALID_URL",
    errorCause: cause,
    hint,
    message,
    status: 0,
  });
}

export interface NormalizeAthenaGatewayBaseUrlOptions {
  defaultBaseUrl?: string;
  label?: string;
}

export function normalizeAthenaGatewayBaseUrl(
  input: string | null | undefined,
  options: NormalizeAthenaGatewayBaseUrlOptions = {}
): string {
  const label = options.label ?? "Athena gateway base URL";
  const candidate = input ?? options.defaultBaseUrl;

  if (candidate === undefined || candidate === null) {
    throw invalidBaseUrlError(
      `${label} must be a non-empty absolute http(s) URL. Received ${describeReceivedValue(input)}.`,
      'Set ATHENA_URL in the explicit env object (or pass createClient({ url, key })) to a full URL such as "https://mirror2.athena-cluster.com".'
    );
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    throw invalidBaseUrlError(
      `${label} must be a non-empty absolute http(s) URL. Received ${describeReceivedValue(candidate)}.`,
      'Set ATHENA_URL in the explicit env object (or pass createClient({ url, key })) to a full URL such as "https://mirror2.athena-cluster.com".'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw invalidBaseUrlError(
      `${label} must be a valid absolute http(s) URL. Received ${describeReceivedValue(candidate)}.`,
      'Use a full URL including the protocol, for example "https://mirror2.athena-cluster.com".',
      error
    );
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw invalidBaseUrlError(
      `${label} must use http or https. Received ${JSON.stringify(trimmed)}.`,
      'Use an Athena gateway URL such as "https://mirror2.athena-cluster.com".'
    );
  }

  if (parsed.search || parsed.hash) {
    throw invalidBaseUrlError(
      `${label} must not include query parameters or hash fragments. Received ${JSON.stringify(trimmed)}.`,
      'Pass only the base URL. Endpoint paths such as "/gateway/fetch" are appended by the SDK.'
    );
  }

  return parsed.toString().replace(/\/+$/, "");
}

export function buildAthenaGatewayUrl(baseUrl: string, path: string): string {
  if (!path.startsWith("/")) {
    throw invalidBaseUrlError(
      `Athena gateway path must start with "/". Received ${JSON.stringify(path)}.`,
      'Use a leading slash such as "/gateway/fetch" or "/".'
    );
  }

  return `${baseUrl}${path}`;
}
