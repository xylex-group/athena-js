export const ATHENA_EVENT_INGRESS_UNAVAILABLE =
  "ATHENA_EVENT_INGRESS_UNAVAILABLE" as const;
export const ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED =
  "ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED" as const;
export const ATHENA_EVENT_INGRESS_FAILED =
  "ATHENA_EVENT_INGRESS_FAILED" as const;
export const ATHENA_INGRESS_MOLLIE_UNAVAILABLE =
  "ATHENA_INGRESS_MOLLIE_UNAVAILABLE" as const;
export const ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID =
  "ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID" as const;
export const ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID =
  "ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID" as const;

export type AthenaEventIngressErrorCode =
  | typeof ATHENA_EVENT_INGRESS_UNAVAILABLE
  | typeof ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED
  | typeof ATHENA_EVENT_INGRESS_FAILED
  | typeof ATHENA_INGRESS_MOLLIE_UNAVAILABLE
  | typeof ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID
  | typeof ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID;

export class AthenaEventIngressError extends Error {
  readonly code: AthenaEventIngressErrorCode;
  readonly domain: "billing" | "ingress";
  readonly retryable: boolean;
  readonly provider?: string;
  /** Safe envelope facts only — never raw webhook bodies or secrets. */
  readonly diagnostics?: Readonly<{
    bodyBytes?: number;
    bodyKind?: "empty" | "json" | "form" | "unknown";
    connectionId?: string;
    contentType?: string;
    operation?: string;
    providerStatus?: number;
    retryable?: boolean;
    stage?: "parse" | "verify" | "refetch" | "project" | "persist" | "unknown";
  }>;

  constructor(input: {
    code: AthenaEventIngressErrorCode;
    message: string;
    domain?: "billing" | "ingress";
    retryable?: boolean;
    provider?: string;
    diagnostics?: {
      bodyBytes?: number;
      bodyKind?: "empty" | "json" | "form" | "unknown";
      connectionId?: string;
      contentType?: string;
      operation?: string;
      providerStatus?: number;
      retryable?: boolean;
      stage?: "parse" | "verify" | "refetch" | "project" | "persist" | "unknown";
    };
  }) {
    super(input.message);
    this.name = "AthenaEventIngressError";
    this.code = input.code;
    this.domain = input.domain ?? "ingress";
    this.retryable = input.retryable ?? false;
    if (input.provider) {
      this.provider = input.provider;
    }
    if (input.diagnostics) {
      this.diagnostics = input.diagnostics;
    }
  }
}

export function isAthenaEventIngressError(
  error: unknown
): error is AthenaEventIngressError {
  if (error instanceof AthenaEventIngressError) {
    return true;
  }
  if (error == null || typeof error !== "object") {
    return false;
  }
  const record = error as { code?: unknown; name?: unknown };
  return (
    record.name === "AthenaEventIngressError" && typeof record.code === "string"
  );
}

export function eventIngressHttpStatus(error: unknown): number {
  if (!isAthenaEventIngressError(error)) {
    return 400;
  }
  if (error.code === ATHENA_INGRESS_MOLLIE_SIGNATURE_INVALID) {
    return 401;
  }
  if (
    error.code === ATHENA_EVENT_INGRESS_UNAVAILABLE ||
    error.code === ATHENA_EVENT_INGRESS_PERSISTENCE_REQUIRED ||
    error.code === ATHENA_INGRESS_MOLLIE_UNAVAILABLE
  ) {
    return 503;
  }
  return 400;
}
