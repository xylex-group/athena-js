import { dataErrorCodeForProviderFacts } from "./data.ts";
import {
  type AthenaFailureIR,
  failureFromUnknown,
  messageFromUnknown,
} from "./failure.ts";
import type { AthenaErrorDomain, AthenaErrorIR } from "./ir.ts";
import type { AthenaErrorKind } from "./kinds.ts";
import {
  dataErrorDescriptor,
  errorDescriptor,
  errorDescriptorsForDomain,
  storageErrorDescriptor,
} from "./registry.ts";

export interface ClassifyAthenaErrorInput {
  readonly domain: AthenaErrorDomain;
  readonly failure: AthenaFailureIR | unknown;
}

export function classifyAthenaError(
  input: ClassifyAthenaErrorInput
): AthenaErrorIR {
  const failure = asFailure(input.failure);
  const explicit = descriptorForFailure(input.domain, failure);
  if (explicit) {
    return explicit;
  }

  const descriptor = fallbackDescriptor(input.domain, failure);
  return descriptor;
}

function descriptorForFailure(
  domain: AthenaErrorDomain,
  failure: AthenaFailureIR
): AthenaErrorIR | undefined {
  if (!failure.code) {
    return;
  }
  const code = failure.code.toLowerCase();
  if (domain === "storage" && code === "storage_unavailable") {
    return storageErrorDescriptor("storage_provider_unavailable");
  }
  return errorDescriptor(domain, code);
}

function fallbackDescriptor(
  domain: AthenaErrorDomain,
  failure: AthenaFailureIR
): AthenaErrorIR {
  if (domain === "storage") {
    return storageFallbackDescriptor(failure);
  }
  if (domain === "data") {
    return dataFallbackDescriptor(failure);
  }
  if (failure.status === 401 || failure.status === 403) {
    return descriptorByKind(domain, "authorization");
  }
  if (failure.status === 404) {
    return descriptorByKind(domain, "not_found");
  }
  if (failure.status === 503) {
    return descriptorByKind(domain, "unavailable");
  }
  if (failure.status && failure.status >= 400 && failure.status < 500) {
    return descriptorByKind(domain, "validation");
  }
  return descriptorByKind(domain, "internal");
}

function storageFallbackDescriptor(
  failure: AthenaFailureIR
): AthenaErrorIR<string, "storage"> {
  const code = failure.code?.toLowerCase() ?? "";
  const providerCode =
    "providerCode" in failure ? (failure.providerCode ?? "") : "";
  const combined =
    `${code} ${providerCode} ${failure.message ?? ""}`.toLowerCase();
  const status = failure.status;

  if (
    (status === 401 || status === 403) &&
    !isProviderAuthenticationFailure(combined)
  ) {
    return storageErrorDescriptor(
      "storage_authorization_denied"
    ) as AthenaErrorIR<string, "storage">;
  }
  if (
    combined.includes("accessdenied") ||
    combined.includes("access denied") ||
    combined.includes("forbidden")
  ) {
    return storageErrorDescriptor(
      "storage_authorization_denied"
    ) as AthenaErrorIR<string, "storage">;
  }
  if (
    status === 404 ||
    combined.includes("nosuchkey") ||
    combined.includes("not found") ||
    combined.includes("enoent")
  ) {
    return storageErrorDescriptor("storage_file_not_found") as AthenaErrorIR<
      string,
      "storage"
    >;
  }
  if (
    status === 400 ||
    combined.includes("invalidargument") ||
    combined.includes("invalid request") ||
    combined.includes("object key")
  ) {
    return storageErrorDescriptor("storage_invalid_request") as AthenaErrorIR<
      string,
      "storage"
    >;
  }
  if (status === 503 || (failure.source === "http" && status === undefined)) {
    return storageErrorDescriptor(
      "storage_provider_unavailable"
    ) as AthenaErrorIR<string, "storage">;
  }
  return storageErrorDescriptor("storage_internal") as AthenaErrorIR<
    string,
    "storage"
  >;
}

function dataFallbackDescriptor(
  failure: AthenaFailureIR
): AthenaErrorIR<string, "data"> {
  const providerCode =
    "providerCode" in failure ? failure.providerCode : undefined;
  const details = failure.details;
  const hint =
    details && typeof details === "object" && !Array.isArray(details)
      ? (details as { hint?: unknown }).hint
      : undefined;
  const code = dataErrorCodeForProviderFacts({
    hint: typeof hint === "string" ? hint : undefined,
    message: failure.message,
    providerCode,
    transportCode: failure.code,
  });
  const descriptor = dataErrorDescriptor(code);
  if (!descriptor) {
    throw new Error(`No Data Error IR descriptor is registered for ${code}`);
  }
  return descriptor;
}

function isProviderAuthenticationFailure(value: string): boolean {
  return (
    value.includes("invalid access key") ||
    value.includes("credential") ||
    value.includes("authentication")
  );
}

function descriptorByKind(
  domain: AthenaErrorDomain,
  kind: AthenaErrorKind
): AthenaErrorIR {
  const descriptor = errorDescriptorsForDomain(domain).find(
    (candidate) => candidate.kind === kind
  );
  if (!descriptor) {
    throw new Error(
      `No ${kind} Error IR descriptor is registered for ${domain}`
    );
  }
  return descriptor;
}

function asFailure(value: AthenaFailureIR | unknown): AthenaFailureIR {
  if (isFailure(value)) {
    return value;
  }
  return failureFromUnknown("runtime", value);
}

function isFailure(value: unknown): value is AthenaFailureIR {
  if (!value || typeof value !== "object") {
    return false;
  }
  const source = (value as { source?: unknown }).source;
  return source === "http" || source === "provider" || source === "runtime";
}

export function errorKind(error: AthenaErrorIR): AthenaErrorKind {
  return error.kind;
}

export function errorMessage(failure: AthenaFailureIR | unknown): string {
  return isFailure(failure)
    ? (failure.message ?? "Athena request failed")
    : messageFromUnknown(failure);
}
