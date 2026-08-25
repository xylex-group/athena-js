import { AsyncLocalStorage } from "node:async_hooks";

export type AuthTimingSpan =
  | "parse"
  | "session_lookup"
  | "session_refresh"
  | "user_lookup"
  | "authz"
  | "org_lookup"
  | "grants"
  | "avatar"
  | "users_batch"
  | "serialize";

export interface AuthRequestTimingSnapshot {
  authzMs: number;
  avatarMs: number;
  grantsMs: number;
  orgLookupMs: number;
  parseMs: number;
  serializeMs: number;
  sessionLookupMs: number;
  sessionRefreshMs: number;
  sqlAcquireMs: number;
  sqlCount: number;
  sqlExecMs: number;
  userLookupMs: number;
  usersBatchMs: number;
}

const SPAN_KEYS: Record<AuthTimingSpan, keyof AuthRequestTimingSnapshot> = {
  authz: "authzMs",
  avatar: "avatarMs",
  grants: "grantsMs",
  org_lookup: "orgLookupMs",
  parse: "parseMs",
  serialize: "serializeMs",
  session_lookup: "sessionLookupMs",
  session_refresh: "sessionRefreshMs",
  user_lookup: "userLookupMs",
  users_batch: "usersBatchMs",
};

export class AuthRequestTiming {
  private readonly snapshot: AuthRequestTimingSnapshot = {
    authzMs: 0,
    avatarMs: 0,
    grantsMs: 0,
    orgLookupMs: 0,
    parseMs: 0,
    serializeMs: 0,
    sessionLookupMs: 0,
    sessionRefreshMs: 0,
    sqlAcquireMs: 0,
    sqlCount: 0,
    sqlExecMs: 0,
    userLookupMs: 0,
    usersBatchMs: 0,
  };

  addSpan(span: AuthTimingSpan, durationMs: number): void {
    const key = SPAN_KEYS[span];
    this.snapshot[key] += Math.max(0, durationMs);
  }

  addSqlAcquire(durationMs: number): void {
    this.snapshot.sqlAcquireMs += Math.max(0, durationMs);
  }

  addSqlExec(durationMs: number): void {
    this.snapshot.sqlExecMs += Math.max(0, durationMs);
  }

  addSqlCount(count = 1): void {
    this.snapshot.sqlCount += count;
  }

  copy(): AuthRequestTimingSnapshot {
    return { ...this.snapshot };
  }

  toServerTimingHeader(totalMs: number): string {
    const snap = this.snapshot;
    const parts = [
      `parse;dur=${Math.round(snap.parseMs)}`,
      `session_lookup;dur=${Math.round(snap.sessionLookupMs)}`,
      `authz;dur=${Math.round(snap.authzMs)}`,
      `org_lookup;dur=${Math.round(snap.orgLookupMs)}`,
      `sql_acquire;dur=${Math.round(snap.sqlAcquireMs)}`,
      `sql_exec;dur=${Math.round(snap.sqlExecMs)}`,
      `serialize;dur=${Math.round(snap.serializeMs)}`,
      `total;dur=${Math.round(totalMs)}`,
      `sql_count;desc="${snap.sqlCount}"`,
    ];
    if (snap.sessionRefreshMs > 0) {
      parts.push(`session_refresh;dur=${Math.round(snap.sessionRefreshMs)}`);
    }
    if (snap.userLookupMs > 0) {
      parts.push(`user_lookup;dur=${Math.round(snap.userLookupMs)}`);
    }
    if (snap.grantsMs > 0) {
      parts.push(`grants;dur=${Math.round(snap.grantsMs)}`);
    }
    if (snap.avatarMs > 0) {
      parts.push(`avatar;dur=${Math.round(snap.avatarMs)}`);
    }
    if (snap.usersBatchMs > 0) {
      parts.push(`users_batch;dur=${Math.round(snap.usersBatchMs)}`);
    }
    return parts.join(", ");
  }
}

const storage = new AsyncLocalStorage<AuthRequestTiming>();

export function currentAuthRequestTiming(): AuthRequestTiming | undefined {
  return storage.getStore();
}

export function runWithAuthRequestTiming<T>(
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(new AuthRequestTiming(), fn);
}

export async function timeAuthSpan<T>(
  span: AuthTimingSpan,
  fn: () => Promise<T>
): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    currentAuthRequestTiming()?.addSpan(span, performance.now() - started);
  }
}

export async function timeAuthSql<T>(fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    return await fn();
  } finally {
    const timing = currentAuthRequestTiming();
    if (timing) {
      timing.addSqlExec(performance.now() - started);
      timing.addSqlCount(1);
    }
  }
}

export function instrumentAuthStoreMethods<T extends object>(stores: T): T {
  return new Proxy(stores, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function" || property === "then") {
        return value;
      }
      return (...args: unknown[]) => {
        const result = (value as (...inner: unknown[]) => unknown).apply(
          target,
          args
        );
        if (
          result !== null &&
          typeof result === "object" &&
          "then" in result &&
          typeof (result as Promise<unknown>).then === "function"
        ) {
          return timeAuthSql(() => result as Promise<unknown>);
        }
        return result;
      };
    },
  }) as T;
}

export const AUTH_TIMING_EXPOSE_HEADERS =
  "Server-Timing, X-Athena-Time, x-athena-trace-id, x-request-id";

export function attachAuthTimingHeaders(
  response: Response,
  totalMs: number
): Response {
  const headers = new Headers(response.headers);
  const timing = currentAuthRequestTiming();
  headers.set(
    "Server-Timing",
    (timing ?? new AuthRequestTiming()).toServerTimingHeader(totalMs)
  );
  headers.set("X-Athena-Time", `${Math.round(totalMs)}ms`);
  const exposed = headers.get("Access-Control-Expose-Headers");
  if (exposed) {
    if (!exposed.toLowerCase().includes("server-timing")) {
      headers.set(
        "Access-Control-Expose-Headers",
        `${exposed}, ${AUTH_TIMING_EXPOSE_HEADERS}`
      );
    }
  } else {
    headers.set("Access-Control-Expose-Headers", AUTH_TIMING_EXPOSE_HEADERS);
  }
  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}
