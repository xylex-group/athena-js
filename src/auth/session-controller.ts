/**
 * Canonical Auth session owner.
 *
 * AthenaAuthClient → AthenaAuthSessionController → SessionStore
 *
 * Mutations (accept / invalidate / refresh completion) go through this
 * controller. React and Auth UI project snapshots only.
 */

import {
  createAuthSessionPersistenceAuthority,
  type InternalAuthSessionPersistence,
  type InternalAuthSessionPersistenceAuthority,
} from "./client/session-persistence.ts";
import {
  type AthenaAuthSessionSnapshot,
  type AthenaAuthSessionStatus,
  type AthenaAuthSessionStore,
  type AthenaInitialAuthState,
  createAthenaAuthSessionStore,
} from "./session-store.ts";

export type { AthenaInitialAuthState } from "./session-store.ts";

export type AthenaAuthSessionInvalidateReason = "signOut" | "revoke" | "manual";

export interface AthenaAuthSessionController<TSession = unknown> {
  accept(
    session: TSession | null,
    status?: Exclude<AthenaAuthSessionStatus, "loading" | "unknown">
  ): void;
  beginPersistenceMutation(): number;
  endPersistenceMutation(): void;
  beginRefresh(): { epoch: number; skipped: boolean };
  clearPersistedSession(): Promise<void>;
  clearPersistedSessionAtGeneration(generation: number): Promise<void>;
  clearPersistedSessionForRefresh(epoch: number): Promise<void>;
  completeRefresh(
    epoch: number,
    result:
      | { ok: true; session: TSession | null }
      | { ok: false; error: unknown; clearSession?: boolean }
  ): void;
  get(): TSession | null;
  getPersistenceGeneration(): number;
  getSnapshot(): AthenaAuthSessionSnapshot<TSession>;
  hydrate(state: AthenaInitialAuthState<TSession>): boolean;
  invalidate(reason?: AthenaAuthSessionInvalidateReason): number;
  isSignOutInvalidationActive(): boolean;
  isPersistenceGenerationCurrent(generation: number): boolean;
  persistSessionToken(token: string): Promise<void>;
  persistSessionTokenAtGeneration(
    token: string,
    generation: number
  ): Promise<void>;
  persistSessionTokenForRefresh(epoch: number, token: string): Promise<void>;
  releaseInvalidation(reason?: AthenaAuthSessionInvalidateReason): void;
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
  /** Underlying store — tests / advanced adapters only. */
  readonly store: AthenaAuthSessionStore<TSession>;
  subscribe(
    listener: (snapshot: AthenaAuthSessionSnapshot<TSession>) => void
  ): () => void;
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

export function createAthenaAuthSessionController<TSession = unknown>(
  input: {
    sessionPersistence?: InternalAuthSessionPersistence;
    sessionPersistenceAuthority?: InternalAuthSessionPersistenceAuthority;
  } = {}
): AthenaAuthSessionController<TSession> {
  const store = createAthenaAuthSessionStore<TSession>();
  const persistence: InternalAuthSessionPersistenceAuthority | undefined =
    input.sessionPersistenceAuthority ??
    createAuthSessionPersistenceAuthority(input.sessionPersistence);
  const refreshGenerations = new Map<number, number>();
  let activeSignOutInvalidations = 0;

  return {
    accept(session, status) {
      persistence?.advanceGeneration();
      store.setSession(session, status);
    },
    beginPersistenceMutation() {
      persistence?.beginAuthMutation();
      persistence?.advanceGeneration();
      return persistence?.getGeneration() ?? 0;
    },
    endPersistenceMutation() {
      persistence?.endAuthMutation();
    },
    beginRefresh() {
      if (
        activeSignOutInvalidations > 0 ||
        persistence?.hasActiveSignOutInvalidations() === true
      ) {
        return { epoch: store.getSnapshot().epoch, skipped: true };
      }
      const result = store.beginRefresh();
      if (!result.skipped) {
        refreshGenerations.set(result.epoch, persistence?.getGeneration() ?? 0);
      }
      return result;
    },
    clearPersistedSession() {
      return persistence?.clearSession() ?? Promise.resolve();
    },
    clearPersistedSessionAtGeneration(generation) {
      return (
        persistence?.clearSessionAtGeneration(generation) ?? Promise.resolve()
      );
    },
    clearPersistedSessionForRefresh(epoch) {
      const generation = refreshGenerations.get(epoch);
      return generation === undefined
        ? Promise.resolve()
        : (persistence?.clearSessionAtGeneration(generation) ??
            Promise.resolve());
    },
    completeRefresh(epoch, result) {
      const previousEpoch = store.getSnapshot().epoch;
      const refreshGeneration = refreshGenerations.get(epoch);
      store.completeRefresh(epoch, result);
      refreshGenerations.delete(epoch);
      if (
        store.getSnapshot().epoch !== previousEpoch &&
        refreshGeneration !== undefined &&
        persistence?.hasActiveAuthMutations() !== true &&
        (persistence?.getGeneration() ?? 0) === refreshGeneration
      ) {
        persistence?.advanceGeneration();
      }
    },
    get: () => store.getSnapshot().session,
    getPersistenceGeneration() {
      return persistence?.getGeneration() ?? 0;
    },
    getSnapshot: () => store.getSnapshot(),
    hydrate(state) {
      return store.hydrate(state);
    },
    invalidate(reason) {
      if (reason === "signOut") {
        if (persistence) {
          persistence.beginSignOutInvalidation();
        } else {
          activeSignOutInvalidations += 1;
        }
      }
      persistence?.advanceGeneration();
      store.invalidate(reason);
      return persistence?.getGeneration() ?? 0;
    },
    isSignOutInvalidationActive() {
      return (
        activeSignOutInvalidations > 0 ||
        persistence?.hasActiveSignOutInvalidations() === true
      );
    },
    isPersistenceGenerationCurrent(generation) {
      return (persistence?.getGeneration() ?? 0) === generation;
    },
    persistSessionToken(token) {
      return persistence?.persistSessionToken(token) ?? Promise.resolve();
    },
    persistSessionTokenAtGeneration(token, generation) {
      return (
        persistence?.persistSessionTokenAtGeneration(token, generation) ??
        Promise.resolve()
      );
    },
    persistSessionTokenForRefresh(epoch, token) {
      const generation = refreshGenerations.get(epoch);
      return generation === undefined
        ? Promise.resolve()
        : (persistence?.persistSessionTokenAtGeneration(token, generation) ??
            Promise.resolve());
    },
    releaseInvalidation(reason) {
      if (reason === undefined || reason === "signOut") {
        if (persistence) {
          persistence.releaseSignOutInvalidation();
        } else {
          activeSignOutInvalidations = Math.max(
            0,
            activeSignOutInvalidations - 1
          );
        }
      }
    },
    setError(error) {
      store.setError(error);
    },
    setSession(session, status) {
      persistence?.advanceGeneration();
      store.setSession(session, status);
    },
    shouldInvalidateForRevokedTokens(tokens) {
      const current = readSessionToken(store.getSnapshot().session);
      if (!current) {
        return false;
      }
      return tokens.some((token) => token === current);
    },
    store,
    subscribe: (listener) => store.subscribe(listener),
  };
}
