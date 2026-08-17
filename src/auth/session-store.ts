/**
 * Framework-independent auth session snapshot store.
 *
 * Owned by {@link createAthenaAuthSessionController}. Do not treat this store
 * as a second application API.
 *
 * Invariants:
 * - SESSION-INV-01 single-flight refresh
 * - SESSION-INV-02/03/04 last-authoritative wins (monotonic epoch)
 * - SESSION-INV-05 transport error does not clear a valid session
 * - SESSION-INV-06 definitive 401/invalid clears when completeRefresh clearSession
 * - SESSION-INV-07 ordered subscriber notifications
 */

export type AthenaAuthSessionStatus =
  | "unknown"
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

export interface AthenaAuthSessionSnapshot<TSession = unknown> {
  epoch: number;
  error: unknown | null;
  session: TSession | null;
  status: AthenaAuthSessionStatus;
}

export type AthenaAuthSessionListener<TSession = unknown> = (
  snapshot: AthenaAuthSessionSnapshot<TSession>
) => void;

export interface AthenaAuthSessionStore<TSession = unknown> {
  getSnapshot(): AthenaAuthSessionSnapshot<TSession>;
  invalidate(reason?: "signOut" | "revoke" | "manual"): void;
  setSession(
    session: TSession | null,
    status?: Exclude<AthenaAuthSessionStatus, "loading" | "unknown">
  ): void;
  setError(error: unknown): void;
  beginRefresh(): { epoch: number; skipped: boolean };
  completeRefresh(
    epoch: number,
    result:
      | { ok: true; session: TSession | null }
      | { ok: false; error: unknown; clearSession?: boolean }
  ): void;
  subscribe(listener: AthenaAuthSessionListener<TSession>): () => void;
}

export function createAthenaAuthSessionStore<
  TSession = unknown,
>(): AthenaAuthSessionStore<TSession> {
  let epoch = 0;
  let inFlightEpoch: number | null = null;
  let snapshot: AthenaAuthSessionSnapshot<TSession> = {
    epoch: 0,
    error: null,
    session: null,
    status: "unknown",
  };
  const listeners = new Set<AthenaAuthSessionListener<TSession>>();

  const emit = () => {
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  };

  const commit = (next: AthenaAuthSessionSnapshot<TSession>) => {
    snapshot = next;
    emit();
  };

  return {
    getSnapshot() {
      return snapshot;
    },

    invalidate(reason = "manual") {
      epoch += 1;
      inFlightEpoch = null;
      commit({
        epoch,
        error: null,
        session: null,
        status: reason === "signOut" || reason === "revoke"
          ? "unauthenticated"
          : "unauthenticated",
      });
    },

    setSession(session, status) {
          // Authoritative mutation cancels in-flight refresh (INV-Q: setActive wins).
          epoch += 1;
          inFlightEpoch = null;
          const nextStatus =
            status ?? (session == null ? "unauthenticated" : "authenticated");
          commit({
            epoch,
            error: null,
            session,
            status: nextStatus,
          });
        },

        setError(error) {
          epoch += 1;
          // Transport/infrastructure errors must not clear a still-valid session
          // and must not cancel an in-flight refresh.
          commit({
            epoch,
            error,
            session: snapshot.session,
            status: snapshot.session == null ? "error" : snapshot.status,
          });
        },

        beginRefresh() {
          if (inFlightEpoch != null) {
            return { epoch: inFlightEpoch, skipped: true };
          }
          epoch += 1;
          inFlightEpoch = epoch;
          commit({
            epoch,
            error: null,
            session: snapshot.session,
            status: "loading",
          });
          return { epoch, skipped: false };
        },

        completeRefresh(requestEpoch, result) {
          // Stale, superseded by mutation, or cancelled refresh — ignore.
          if (inFlightEpoch !== requestEpoch) {
            return;
          }
          inFlightEpoch = null;
          epoch += 1;
          if (result.ok) {
            commit({
              epoch,
              error: null,
              session: result.session,
              status: result.session == null ? "unauthenticated" : "authenticated",
            });
            return;
          }
          const clear = result.clearSession === true;
          commit({
            epoch,
            error: result.error,
            session: clear ? null : snapshot.session,
            status: clear
              ? "unauthenticated"
              : snapshot.session == null
                ? "error"
                : snapshot.status,
          });
        },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
