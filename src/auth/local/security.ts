import { AthenaAuthRuntimeError } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";

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

  clear(key: string): void {
    this.buckets.delete(key);
  }

  isLimited(key: string): boolean {
    const existing = this.buckets.get(key);
    return existing !== undefined && existing.resetAt > Date.now() && existing.count >= this.limit;
  }
}

export interface OtpRateLimiter {
  clear(key: string): Promise<void>;
  consume(key: string): Promise<boolean>;
  isLimited(key: string): Promise<boolean>;
}

export class StoreRateLimiter implements OtpRateLimiter {
  private readonly fallback: MemoryRateLimiter;

  constructor(
    private readonly resolveStores: () => AthenaAuthStores | undefined,
    private readonly limit: number,
    private readonly windowMs: number
  ) {
    this.fallback = new MemoryRateLimiter(limit, windowMs);
  }

  async consume(key: string): Promise<boolean> {
    const stores = this.resolveStores();
    return stores
      ? stores.consumeRateLimit(key, this.limit, this.windowMs)
      : this.fallback.consume(key);
  }

  async clear(key: string): Promise<void> {
    const stores = this.resolveStores();
    if (stores) {
      await stores.clearRateLimit(key);
      return;
    }
    this.fallback.clear(key);
  }

  async isLimited(key: string): Promise<boolean> {
    const stores = this.resolveStores();
    return stores
      ? stores.isRateLimited(key, this.limit)
      : this.fallback.isLimited(key);
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
}

export function requestOrigin(request: Request): string | undefined {
  const origin = request.headers.get("origin")?.trim();
  if (origin) {
    return origin.replace(/\/+$/, "");
  }
  const referer = request.headers.get("referer")?.trim();
  if (!referer) {
    return;
  }
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    /* invalid Referer */
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

export function resolveTrustedCallbackUrl(input: {
  callbackUrl?: string | null;
  requestUrl: string | URL;
  trustedOrigins: readonly string[];
  fallbackPath?: string;
}): string {
  const trustedOrigins = input.trustedOrigins.map((origin) =>
    new URL(origin).origin
  );
  const trusted = new Set<string>(trustedOrigins);
  const requestOrigin = new URL(input.requestUrl).origin;
  const requestOriginIsTrusted = trusted.has(requestOrigin);
  const canonicalOrigin = trustedOrigins[0] ?? requestOrigin;
  const raw = input.callbackUrl?.trim();
  const fallback = input.fallbackPath ?? "/";
  const baseOrigin = requestOriginIsTrusted ? requestOrigin : canonicalOrigin;
  const candidate = raw
    ? parseCallbackUrl(raw, new URL(baseOrigin))
    : new URL(fallback, new URL(baseOrigin));
  if (
    candidate.protocol !== "http:" &&
    candidate.protocol !== "https:"
  ) {
    throw AthenaAuthRuntimeError.badRequest("callbackURL is not trusted");
  }
  if (candidate.username || candidate.password) {
    throw AthenaAuthRuntimeError.badRequest("callbackURL is not trusted");
  }
  const noConfiguredOriginCompatibility =
    trustedOrigins.length === 0 &&
    candidate.origin === requestOrigin;
  if (!trusted.has(candidate.origin) && !noConfiguredOriginCompatibility) {
    throw AthenaAuthRuntimeError.badRequest("callbackURL is not trusted");
  }
  return candidate.toString();
}

function parseCallbackUrl(raw: string, base: URL): URL {
  if (
    raw.startsWith("//") ||
    !(raw.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(raw))
  ) {
    throw AthenaAuthRuntimeError.badRequest("callbackURL is not trusted");
  }
  try {
    return new URL(raw, base);
  } catch {
    throw AthenaAuthRuntimeError.badRequest("callbackURL is not trusted");
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

export async function readFormBody(
  request: Request,
  limitBytes: number
): Promise<Record<string, string>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw AthenaAuthRuntimeError.badRequest(
      "OAuth protocol requests must use application/x-www-form-urlencoded"
    );
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number.parseInt(contentLength, 10) > limitBytes) {
    throw AthenaAuthRuntimeError.payloadTooLarge();
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > limitBytes) {
    throw AthenaAuthRuntimeError.payloadTooLarge();
  }
  const parsed = new URLSearchParams(text);
  const body: Record<string, string> = {};
  for (const [key, value] of parsed.entries()) {
    if (Object.hasOwn(body, key)) {
      throw AthenaAuthRuntimeError.badRequest(
        `OAuth parameter "${key}" must be supplied once`
      );
    }
    body[key] = value;
  }
  return body;
}

export function asStringField(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const value = body[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Better Auth organization.update posts `{ data: { name, slug, logo }, organizationId }`.
 * Top-level fields remain accepted for older callers.
 */
export function asDataEnvelopeStringField(
  body: Record<string, unknown>,
  key: string
): string | undefined {
  const nested = body.data;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const fromData = asStringField(nested as Record<string, unknown>, key);
    if (fromData !== undefined) {
      return fromData;
    }
  }
  return asStringField(body, key);
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
