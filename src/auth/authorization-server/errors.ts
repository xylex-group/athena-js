export type OAuthProtocolErrorCode =
  | "access_denied"
  | "invalid_client"
  | "invalid_grant"
  | "invalid_request"
  | "invalid_scope"
  | "server_error"
  | "temporarily_unavailable"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type";

export class OAuthProtocolError extends Error {
  readonly code: OAuthProtocolErrorCode;
  readonly description: string;
  readonly status: number;

  constructor(
    code: OAuthProtocolErrorCode,
    description: string,
    options: { cause?: unknown; status?: number } = {}
  ) {
    super(description, { cause: options.cause });
    this.name = "OAuthProtocolError";
    this.code = code;
    this.description = description;
    this.status = options.status ?? (code === "invalid_client" ? 401 : 400);
  }
}

export function oauthErrorBody(error: OAuthProtocolError): {
  error: OAuthProtocolErrorCode;
  error_description: string;
} {
  return {
    error: error.code,
    error_description: error.description,
  };
}

export function oauthJsonResponse(
  status: number,
  body: unknown,
  headers?: HeadersInit
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("cache-control", "no-store");
  responseHeaders.set("content-type", "application/json; charset=utf-8");
  responseHeaders.set("pragma", "no-cache");
  return new Response(JSON.stringify(body), {
    headers: responseHeaders,
    status,
  });
}

export function oauthErrorResponse(
  error: OAuthProtocolError,
  headers?: HeadersInit
): Response {
  return oauthJsonResponse(error.status, oauthErrorBody(error), headers);
}

export function oauthInvalidRequest(description: string): OAuthProtocolError {
  return new OAuthProtocolError("invalid_request", description);
}
