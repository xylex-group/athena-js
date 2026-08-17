/**
 * Lightweight HTTP/API error used by social-provider helpers.
 *
 * Intentionally does not depend on better-call; status can be a number or
 * string label used by call sites for branching.
 */
export class APIError extends Error {
  status: string | number;
  statusCode: number;
  body: Record<string, unknown> | undefined;
  headers: Headers | undefined;

  constructor(
    status: string | number,
    body?: { message?: string; code?: string; [key: string]: unknown } | string,
    options?: { cause?: unknown }
  ) {
    const message =
      typeof body === "string"
        ? body
        : (body?.message ??
          (typeof status === "string" ? status : `HTTP ${status}`));
    super(message, options);
    this.name = "APIError";
    this.status = status;
    this.statusCode = typeof status === "number" ? status : 500;
    this.body = typeof body === "string" ? { message: body } : body;
    this.headers = undefined;
  }

  static fromStatus(
    status: string | number,
    body?: { message?: string; code?: string; [key: string]: unknown }
  ): APIError {
    return new APIError(status, body);
  }

  static from(
    status: string | number,
    error: { code: string; message: string }
  ): APIError {
    return new APIError(status, {
      code: error.code,
      message: error.message,
    });
  }
}
