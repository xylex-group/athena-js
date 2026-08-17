/**
 * Canonical Auth session owner.
 *
 * AthenaAuthClient → AthenaAuthSessionController → SessionStore
 *
 * Mutations (accept / invalidate / refresh completion) go through this
 * controller. React and Auth UI project snapshots only.
 */

import {
  type AthenaAuthSessionSnapshot,
  type AthenaAuthSessionStatus,
  type AthenaAuthSessionStore,
  createAthenaAuthSessionStore,
} from "./session-store.ts";

export type AthenaAuthSessionInvalidateReason = "signOut" | "revoke" | "manual";

export interface AthenaAuthSessionController<TSession = unknown> {
  accept(
    session: TSession | null,
    status?: Exclude<AthenaAuthSessionStatus, "loading" | "unknown">
  ): void;
  beginRefresh(): { epoch: number; skipped: boolean };
  completeRefresh(
    epoch: number,
    result:
      | { ok: true; session: TSession | null }
      | { ok: false; error: unknown; clearSession?: boolean }
  ): void;
  get(): TSession | null;
  getSnapshot(): AthenaAuthSessionSnapshot<TSession>;
  invalidate(reason?: AthenaAuthSessionInvalidateReason): void;
  setError(error: unknown): void;
  /**
   * Advanced local write. Prefer {@link accept} after transport mutations.
   * Kept so existing adapters that call `auth.session.setSession` keep working.
   */
  setSession(
    session: TSession | null,
    status?: Exclude<AthenaAuthSessionStatus, "loading" | "unknown">
  ): void;
  shouldInvalidateForRevokedTokens(tokens: readonly string[]): boolean;
  subscribe(
    listener: (snapshot: AthenaAuthSessionSnapshot<TSession>) => void
  ): () => void;
  /** Underlying store — tests / advanced adapters only. */
  readonly store: AthenaAuthSessionStore<TSession>;
}

function readSessionToken(session: unknown): string | null {
  if (!session || typeof session !== "object") {
    return null;
  }
  const inner = (session as { session?: { id?: unknown; token?: unknown } })
    .session;
  if (!inner || typeof inner !== "object") {
    return null;
  }
  if (typeof inner.token === "string" && inner.token.trim().length > 0) {
    return inner.token;
  }
  if (typeof inner.id === "string" && inner.id.trim().length > 0) {
    return inner.id;
  }
  return null;
}

export function createAthenaAuthSessionController<
  TSession = unknown,
>(): AthenaAuthSessionController<TSession> {
  const store = createAthenaAuthSessionStore<TSession>();

  return {
    store,
    getSnapshot: () => store.getSnapshot(),
    get: () => store.getSnapshot().session,
    subscribe: (listener) => store.subscribe(listener),
    accept(session, status) {
      store.setSession(session, status);
    },
    setSession(session, status) {
      store.setSession(session, status);
    },
    invalidate(reason) {
      store.invalidate(reason);
    },
    setError(error) {
      store.setError(error);
    },
    beginRefresh() {
      return store.beginRefresh();
    },
    completeRefresh(epoch, result) {
      store.completeRefresh(epoch, result);
    },
    shouldInvalidateForRevokedTokens(tokens) {
      const current = readSessionToken(store.getSnapshot().session);
      if (!current) {
        return false;
      }
      return tokens.some((token) => token === current);
    },
  };
}
