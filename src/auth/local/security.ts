import { AthenaAuthRuntimeError } from "./errors.ts";

export interface RateLimitBucket {
  count: number;
  resetAt: number;
}

export class MemoryRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {}

  consume(key: string): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.limit) {
      return false;
    }
    existing.count += 1;
    return true;
  }
}

export function requestClientIp(
  request: Request,
  trustedProxy: boolean
): string | undefined {
  if (trustedProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0]?.trim() || undefined;
    }
    const realIp = request.headers.get("x-real-ip")?.trim();
    if (realIp) {
      return realIp;
    }
  }
  return undefined;
}

export function requestOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }
  const referer = request.headers.get("referer")?.trim();
  if (!referer) {
    return undefined;
  }
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

export function isTrustedOrigin(
  origin: string | undefined,
  trustedOrigins: string[],
  requestUrl: URL
): boolean {
  if (!origin) {
    return true;
  }
  const allowed = new Set([
    `${requestUrl.protocol}//${requestUrl.host}`,
    ...trustedOrigins.map((value) => value.replace(/\/+$/, "")),
  ]);
  return allowed.has(origin.replace(/\/+$/, ""));
}

export function enforceOrigin(
  request: Request,
  trustedOrigins: string[]
): void {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return;
  }
  const origin = requestOrigin(request);
  if (!isTrustedOrigin(origin, trustedOrigins, new URL(request.url))) {
    throw AthenaAuthRuntimeError.forbidden("Origin is not trusted");
  }
}

export async function readJsonBody(
  request: Request,
  limitBytes: number
): Promise<Record<string, unknown>> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > limitBytes) {
    throw AthenaAuthRuntimeError.payloadTooLarge();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limitBytes) {
    throw AthenaAuthRuntimeError.payloadTooLarge();
  }
  if (!text.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw AthenaAuthRuntimeError.badRequest("Invalid JSON body");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof AthenaAuthRuntimeError) {
      throw error;
    }
    throw AthenaAuthRuntimeError.badRequest("Invalid JSON body");
  }
}

export function asStringField(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

export function requireStringField(
  body: Record<string, unknown>,
  key: string
): string {
  const value = asStringField(body, key)?.trim();
  if (!value) {
    throw AthenaAuthRuntimeError.badRequest(`${key} is required`);
  }
  return value;
}
