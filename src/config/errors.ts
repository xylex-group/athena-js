export type AthenaService = "db" | "auth" | "chat" | "storage" | "billing";

export type AthenaConfigurationErrorCode =
  | "ATHENA_NO_SERVICE_CONFIGURED"
  | "ATHENA_SERVICE_NOT_CONFIGURED"
  | "ATHENA_AUTH_NOT_AVAILABLE"
  | "ATHENA_API_KEY_REQUIRED"
  | "ATHENA_INVALID_URL"
  | "ATHENA_NEXT_SERVER_RUNTIME_REQUIRED"
  | "ATHENA_NODE_RUNTIME_REQUIRED"
  | "ATHENA_POSTGRES_DIRECT_NODE_REQUIRED"
  | "ATHENA_AUTH_ROUTING_CONFLICT"
  | "ATHENA_AUTH_UPSTREAM_REQUIRED"
  | "ATHENA_AUTH_DUPLICATE_PATH"
  | "ATHENA_AUTH_INVALID_URL"
  | "ATHENA_AUTH_CREDENTIALS_MISMATCH"
  | "ATHENA_AUTH_REQUEST_ORIGIN_REQUIRED"
  | "ATHENA_AUTH_PROXY_CONFIGURATION_INVALID"
  | "ATHENA_AUTH_LOCAL_NODE_REQUIRED"
  | "ATHENA_AUTH_LOCAL_DATABASE_REQUIRED"
  | "ATHENA_AUTH_FEATURE_UNSUPPORTED"
  | "ATHENA_DATABASE_URL_CONFLICT"
  | "ATHENA_RUNTIME_CONFIG_INVALID"
  | "ATHENA_RUNTIME_DISPOSED"
  | "ATHENA_HANDLER_ROOT_CLIENT_REQUIRED"
  | "ATHENA_LOCAL_RUNTIME_REQUIRED"
  | "ATHENA_POSTGRES_DRIVER_MISSING"
  | "ATHENA_BROWSER_SERVER_IMPORT"
  | "ATHENA_RUNTIME_CLOSED"
  | "ATHENA_CLIENT_RUNTIME_VERSION_MISMATCH";

/**
 * Structured configuration failure raised during client construction or
 * unavailable-service access. Distinct from transport/auth/gateway errors.
 */
export class AthenaConfigurationError extends Error {
  readonly code: AthenaConfigurationErrorCode;
  readonly service?: AthenaService;

  constructor(
    code: AthenaConfigurationErrorCode,
    message: string,
    service?: AthenaService,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "AthenaConfigurationError";
    this.code = code;
    this.service = service;
  }
}
