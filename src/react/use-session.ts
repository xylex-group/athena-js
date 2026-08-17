import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  UPSTREAM_UNAVAILABLE_MESSAGE,
  sanitizeAuthErrorMessage,
} from "../http/upstream-html-error.ts";
import type { AthenaSessionData } from "../auth/session-data.ts";
import { toSessionData } from "../auth/session-data.ts";
import type { AthenaAuthSessionSnapshot } from "../auth/session-store.ts";
import { deriveSessionView } from "../auth/session-view.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthErrorCode,
  AthenaAuthErrorDetails,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthResult,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthUser,
} from "../auth/types.ts";

export interface UseSessionOptions {
  callOptions?: AthenaAuthCallOptions;
  enabled?: boolean;
  fetchInput?: AthenaAuthFetchCompatibleInput;
  refetchOnMount?: boolean;
}

export interface UseSessionResult {
  data: AthenaSessionData | null;
  error: AthenaAuthErrorDetails | null;
  isAuthenticated: boolean;
  isPending: boolean;
  isRefetching: boolean;
  organization: AthenaSessionData["organization"] | null;
  organizationId: string | null;
  refetch: () => Promise<AthenaSessionData | null>;
  session: AthenaAuthSession | null;
  user: AthenaAuthUser | null;
}

type SessionGetter = (
  input?: AthenaAuthFetchCompatibleInput,
  options?: AthenaAuthCallOptions
) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>;

type SessionStoreApi = {
  getSnapshot: () => AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>;
  subscribe: (
    listener: (
      snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>
    ) => void
  ) => () => void;
  refresh?: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<unknown>;
};

/**
 * Anything `useSession` can resolve a `getSession` from:
 * - auth-ui compatibility client → top-level `getSession`
 * - `createClient(...)` → `auth.getSession`
 * - `createClient(...).auth` → `getSession` on bindings
 */
export type UseSessionAuthClient =
  | { getSession: SessionGetter; session?: SessionStoreApi; auth?: never }
  | {
      auth: {
        getSession: SessionGetter;
        session?: SessionStoreApi;
      };
    }
  | {
      getSession: SessionGetter;
      session?: SessionStoreApi;
      auth: {
        getSession?: SessionGetter;
        session?: SessionStoreApi;
      };
    };

function resolveGetSession(authClient: UseSessionAuthClient): SessionGetter {
  if (
    "getSession" in authClient &&
    typeof authClient.getSession === "function"
  ) {
    return authClient.getSession;
  }

  if (
    "auth" in authClient &&
    authClient.auth &&
    typeof authClient.auth.getSession === "function"
  ) {
    return authClient.auth.getSession;
  }

  throw new Error(
    "useSession requires an auth-capable client (createClient(...).auth)"
  );
}

function resolveSessionStore(
  authClient: UseSessionAuthClient
): SessionStoreApi | null {
  if (
    "session" in authClient &&
    authClient.session &&
    typeof authClient.session.getSnapshot === "function" &&
    typeof authClient.session.subscribe === "function"
  ) {
    return authClient.session;
  }
  if (
    "auth" in authClient &&
    authClient.auth &&
    authClient.auth.session &&
    typeof authClient.auth.session.getSnapshot === "function" &&
    typeof authClient.auth.session.subscribe === "function"
  ) {
    return authClient.auth.session;
  }
  return null;
}

function toFallbackErrorDetails(
  code: AthenaAuthErrorCode,
  message: string,
  status: number
): AthenaAuthErrorDetails {
  return {
    code,
    message,
    status,
  };
}

function normalizeTransport(
  data: AthenaAuthSessionResponse | null | undefined
): AthenaSessionData | null {
  if (!(data?.user?.id && data.session?.id)) {
    return null;
  }
  // Browser path: activeId === rawActiveId (no server organization repair).
  return toSessionData(data);
}

/** Stable fallback for `useSyncExternalStore` when no session store is wired. */
const EMPTY_STORE_SNAPSHOT: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse> =
  Object.freeze({
    epoch: 0,
    error: null,
    session: null,
    status: "unknown" as const,
  });

function snapshotToResult(
  snapshot: AthenaAuthSessionSnapshot<AthenaAuthSessionResponse>
): Omit<UseSessionResult, "refetch"> {
  const data = normalizeTransport(snapshot.session);
  const view = deriveSessionView(data);
  const isPending =
    snapshot.status === "loading" || snapshot.status === "unknown";
  let error: AthenaAuthErrorDetails | null = null;
  if (snapshot.error != null && snapshot.status === "error") {
    const rawMessage =
      snapshot.error instanceof Error
        ? snapshot.error.message
        : String(snapshot.error);
    error = toFallbackErrorDetails(
      "NETWORK_ERROR",
      sanitizeAuthErrorMessage(rawMessage, UPSTREAM_UNAVAILABLE_MESSAGE),
      0
    );
  }
  return {
    data: view.data,
    error,
    isAuthenticated: view.isAuthenticated,
    isPending,
    isRefetching: snapshot.status === "loading" && data != null,
    organization: view.organization,
    organizationId: view.organizationId,
    session: view.session,
    user: view.user,
  };
}

/** In-process concurrent getSession dedupe per getter identity. */
const inflightByGetter = new WeakMap<
  SessionGetter,
  Promise<AthenaAuthResult<AthenaAuthSessionResponse>>
>();

function getSessionDeduped(
  getSession: SessionGetter,
  fetchInput: AthenaAuthFetchCompatibleInput | undefined,
  callOptions: AthenaAuthCallOptions | undefined
): Promise<AthenaAuthResult<AthenaAuthSessionResponse>> {
  // Only dedupe default mount/refetch shape (no distinct fetch inputs).
  if (fetchInput !== undefined || callOptions !== undefined) {
    return getSession(fetchInput, callOptions);
  }
  const existing = inflightByGetter.get(getSession);
  if (existing) {
    return existing;
  }
  const promise = getSession(fetchInput, callOptions).finally(() => {
    if (inflightByGetter.get(getSession) === promise) {
      inflightByGetter.delete(getSession);
    }
  });
  inflightByGetter.set(getSession, promise);
  return promise;
}

/**
 * Session hook for Athena.
 *
 * Prefers the canonical `auth.session` SSOT store (`useSyncExternalStore`) when
 * present; falls back to imperative `getSession` polling for older clients.
 *
 * @example
 * ```tsx
 * const athena = createClient({ url, key, auth: { url: "/api/auth" } })
 * const { data, isPending, isAuthenticated } = useSession(athena)
 * ```
 */
export function useSession(
  authClient: UseSessionAuthClient,
  options: UseSessionOptions = {}
): UseSessionResult {
  const enabled = options.enabled ?? true;
  const refetchOnMount = options.refetchOnMount ?? true;
  const store = resolveSessionStore(authClient);
  const getSession = resolveGetSession(authClient);
  const fetchInputRef = useRef(options.fetchInput);
  const callOptionsRef = useRef(options.callOptions);
  const storeRef = useRef(store);
  const getSessionRef = useRef(getSession);
  fetchInputRef.current = options.fetchInput;
  callOptionsRef.current = options.callOptions;
  storeRef.current = store;
  getSessionRef.current = getSession;

  // Hooks must run unconditionally — branch inside after reading store.
  const storeSubscribe = useCallback(
    (onStoreChange: () => void) => {
      if (!(enabled && store)) {
        return () => undefined;
      }
      return store.subscribe(() => {
        onStoreChange();
      });
    },
    [enabled, store]
  );
  const lastSnapshotRef = useRef(EMPTY_STORE_SNAPSHOT);
  const storeGetSnapshot = useCallback(() => {
    if (!store) {
      return EMPTY_STORE_SNAPSHOT;
    }
    const next = store.getSnapshot();
    const prev = lastSnapshotRef.current;
    if (
      prev.epoch === next.epoch &&
      prev.error === next.error &&
      prev.session === next.session &&
      prev.status === next.status
    ) {
      return prev;
    }
    lastSnapshotRef.current = next;
    return next;
  }, [store]);
  const snapshot = useSyncExternalStore(
    storeSubscribe,
    storeGetSnapshot,
    storeGetSnapshot
  );

  useEffect(() => {
    const currentStore = storeRef.current;
    if (!(currentStore && enabled && refetchOnMount)) {
      return;
    }
    const current = currentStore.getSnapshot();
    if (current.status === "unknown") {
      if (typeof currentStore.refresh === "function") {
        void currentStore.refresh(
          fetchInputRef.current,
          callOptionsRef.current
        );
      } else {
        void getSessionRef.current(
          fetchInputRef.current,
          callOptionsRef.current
        );
      }
    }
  }, [enabled, refetchOnMount]);

  const storeRefetch = useCallback(async () => {
    if (!store) {
      return null;
    }
    if (typeof store.refresh === "function") {
      await store.refresh(fetchInputRef.current, callOptionsRef.current);
    } else {
      await getSession(fetchInputRef.current, callOptionsRef.current);
    }
    return normalizeTransport(store.getSnapshot().session);
  }, [store, getSession]);

  // Legacy imperative path state (always declared; only used without store).
  const [data, setData] = useState<AthenaSessionData | null>(null);
  const [error, setError] = useState<AthenaAuthErrorDetails | null>(null);
  const [isPending, setIsPending] = useState<boolean>(enabled);
  const [isRefetching, setIsRefetching] = useState<boolean>(false);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);
  const dataRef = useRef<AthenaSessionData | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const runFetch = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const hasData = dataRef.current !== null;

    if (hasData) {
      setIsRefetching(true);
    } else {
      setIsPending(true);
    }

    try {
      const result = await getSessionDeduped(
        getSessionRef.current,
        fetchInputRef.current,
        callOptionsRef.current
      );
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      if (result.ok) {
        const normalized = normalizeTransport(
          (result.data ?? null) as AthenaAuthSessionResponse | null
        );
        setData(normalized);
        setError(null);
        return normalized;
      }

      setError(
        result.errorDetails ??
          toFallbackErrorDetails(
            "UNKNOWN_ERROR",
            result.error ?? "Failed to fetch session",
            result.status
          )
      );
      return null;
    } catch (requestError) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return null;
      }

      const name =
        requestError && typeof requestError === "object"
          ? (requestError as { name?: string }).name
          : undefined;
      if (name === "AbortError" || name === "TimeoutError") {
        return dataRef.current;
      }

      const message =
        requestError instanceof Error
          ? requestError.message
          : "Failed to fetch session";
      setError(toFallbackErrorDetails("NETWORK_ERROR", message, 0));
      return null;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsPending(false);
        setIsRefetching(false);
      }
    }
  }, []);

  useEffect(() => {
    if (store) {
      return;
    }
    mountedRef.current = true;
    if (enabled && refetchOnMount) {
      void runFetch();
    } else {
      setIsPending(false);
    }
    return () => {
      mountedRef.current = false;
    };
  }, [store, enabled, refetchOnMount, runFetch]);

  const legacyRefetch = useCallback(async () => await runFetch(), [runFetch]);
  const view = useMemo(() => deriveSessionView(data), [data]);

  if (store) {
    const base = snapshotToResult(snapshot);
    return { ...base, refetch: storeRefetch };
  }

  return {
    data: view.data,
    error,
    isAuthenticated: view.isAuthenticated,
    isPending,
    isRefetching,
    organization: view.organization,
    organizationId: view.organizationId,
    refetch: legacyRefetch,
    session: view.session,
    user: view.user,
  };
}
