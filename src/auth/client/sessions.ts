import type { AthenaAuthSessionController } from "../session-controller.ts";
import type {
  AthenaAdminHasPermissionRequest,
  AthenaAdminHasPermissionResponse,
  AthenaAuthBindings,
  AthenaAuthCallOptions,
  AthenaAuthErrorResponse,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthGenericInput,
  AthenaAuthGetUserResponse,
  AthenaAuthGuardResult,
  AthenaAuthHealthResponse,
  AthenaAuthOkResponse,
  AthenaAuthResult,
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthSignOutResponse,
  AthenaAuthStatusResponse,
} from "../types.ts";
import { isRecord } from "./errors.ts";
import type { AuthSessionMutationController } from "./session-mutations.ts";
import { readAuthSessionToken } from "./session-persistence.ts";
import type { AuthTransport } from "./transport.ts";

function toSessionGuardFailure(
  sessionResult: AthenaAuthResult<AthenaAuthSessionResponse>
): AthenaAuthGuardResult {
  if (sessionResult.status === 401 || sessionResult.data === null) {
    return {
      error: sessionResult.error ?? "Unauthorized",
      ok: false,
      reason: "unauthorized",
      sessionResult,
      status: 401,
    };
  }

  return {
    error: sessionResult.error ?? "Failed to resolve current session",
    ok: false,
    reason: "upstream_error",
    sessionResult,
    status: sessionResult.status,
  };
}

function toPermissionGuardFailure(
  permissionResult: AthenaAuthResult<AthenaAdminHasPermissionResponse>,
  sessionResult: AthenaAuthResult<AthenaAuthSessionResponse>
): AthenaAuthGuardResult {
  if (permissionResult.status === 401) {
    return {
      error: permissionResult.error ?? "Unauthorized",
      ok: false,
      permissionResult,
      reason: "unauthorized",
      sessionResult,
      status: 401,
    };
  }

  if (permissionResult.status === 403) {
    return {
      error: permissionResult.error ?? "Forbidden",
      ok: false,
      permissionResult,
      reason: "forbidden",
      sessionResult,
      status: 403,
    };
  }

  return {
    error: permissionResult.error ?? "Failed to resolve permission check",
    ok: false,
    permissionResult,
    reason: "upstream_error",
    sessionResult,
    status: permissionResult.status,
  };
}

export function createAuthSessionClientModule(input: {
  mutations: AuthSessionMutationController;
  sessionStore: AthenaAuthSessionController<AthenaAuthSessionResponse>;
  transport: AuthTransport;
}) {
  const { mutations, sessionStore, transport } = input;
  const { resolvedConfig } = transport;

  const requireSession: AthenaAuthBindings["requireSession"] = async (
    input,
    options
  ) => {
    const sessionInput = input?.fetchOptions
      ? { fetchOptions: input.fetchOptions }
      : undefined;
    const sessionResult = await mutations.fetchSessionResult(
      sessionInput,
      options
    );

    if (!sessionResult.ok || sessionResult.data === null) {
      return toSessionGuardFailure(sessionResult);
    }

    return {
      ok: true,
      session: sessionResult.data,
    };
  };

  const getUser: AthenaAuthBindings["getUser"] = async (input, options) => {
    const sessionResult = await mutations.fetchSessionResult(input, options);

    if (!sessionResult.ok) {
      return {
        ...sessionResult,
        data: null,
      };
    }

    return {
      ...sessionResult,
      data: {
        user: sessionResult.data?.user ?? null,
      } satisfies AthenaAuthGetUserResponse,
    };
  };

  const requirePermission = async (
    endpoint: "/admin/has-permission" | "/organization/has-permission",
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthGuardResult> => {
    const sessionGuard = await requireSession(
      input?.fetchOptions ? { fetchOptions: input.fetchOptions } : undefined,
      options
    );

    if (!sessionGuard.ok) {
      return sessionGuard;
    }

    const permissionResult =
      await transport.postGeneric<AthenaAdminHasPermissionResponse>(
        endpoint,
        input,
        options
      );

    if (!permissionResult.ok) {
      return toPermissionGuardFailure(permissionResult, {
        data: sessionGuard.session,
        error: null,
        errorDetails: null,
        ok: true,
        raw: sessionGuard.session,
        status: 200,
      });
    }

    if (!permissionResult.data?.success) {
      return {
        error: permissionResult.data?.error ?? "Forbidden",
        ok: false,
        permissionResult,
        reason: "forbidden",
        sessionResult: {
          data: sessionGuard.session,
          error: null,
          errorDetails: null,
          ok: true,
          raw: sessionGuard.session,
          status: 200,
        },
        status: 403,
      };
    }

    return sessionGuard;
  };

  const health: AthenaAuthBindings["health"] = async (input, options) => {
    const primary = await transport.getGeneric<AthenaAuthHealthResponse>(
      "/health",
      input,
      options
    );
    if (
      primary.ok ||
      primary.status !== 404 ||
      primary.errorDetails?.code !== "HTTP_ERROR"
    ) {
      return primary;
    }

    const fallback = await transport.getGeneric<AthenaAuthOkResponse>(
      "/ok",
      input,
      options
    );
    if (!fallback.ok) {
      return {
        ...fallback,
        data: null,
      };
    }

    const fallbackStatus =
      isRecord(fallback.data) && typeof fallback.data.ok === "boolean"
        ? fallback.data.ok
          ? "ok"
          : "error"
        : "ok";

    return {
      ...fallback,
      data: {
        status: fallbackStatus,
      },
    };
  };

  const signOut = async (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const invalidationGeneration = sessionStore.invalidate("signOut");
    try {
      const result =
        await transport.executePostWithOptionalInput<AthenaAuthSignOutResponse>(
          resolvedConfig,
          { endpoint: "/sign-out", method: "POST" },
          input,
          options
        );
      await sessionStore.clearPersistedSessionAtGeneration(
        invalidationGeneration
      );
      return result;
    } finally {
      sessionStore.releaseInvalidation("signOut");
    }
  };

  const snapshotToGetSessionResult = (
    snap: ReturnType<typeof sessionStore.getSnapshot>
  ): AthenaAuthResult<AthenaAuthSessionResponse> => {
    if (snap.status === "error") {
      return {
        data: snap.session,
        error: String(
          snap.error instanceof Error ? snap.error.message : snap.error
        ),
        ok: false,
        raw: snap.session,
        status: 502,
      };
    }
    return {
      data: snap.session,
      error: null,
      ok: true,
      raw: snap.session,
      status: 200,
    };
  };

  const waitForInFlightSession = () =>
    new Promise<AthenaAuthResult<AthenaAuthSessionResponse>>((resolve) => {
      const current = sessionStore.getSnapshot();
      if (current.status !== "loading" && current.status !== "unknown") {
        resolve(snapshotToGetSessionResult(current));
        return;
      }
      const unsub = sessionStore.subscribe((next) => {
        if (next.status !== "loading" && next.status !== "unknown") {
          unsub();
          resolve(snapshotToGetSessionResult(next));
        }
      });
    });

  const getSession = async (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthResult<AthenaAuthSessionResponse>> => {
    const { epoch, skipped } = sessionStore.beginRefresh();
    if (skipped) {
      const snap = sessionStore.getSnapshot();
      if (
        !sessionStore.isSignOutInvalidationActive() &&
        (snap.status === "loading" || snap.status === "unknown")
      ) {
        return waitForInFlightSession();
      }
      return snapshotToGetSessionResult(snap);
    }
    let definitiveSessionLoss = false;
    try {
      const result = await mutations.fetchSessionResult(input, options);
      if (result.ok) {
        const token = readAuthSessionToken(result.data);
        if (token) {
          await sessionStore.persistSessionTokenForRefresh(epoch, token);
        } else if (result.data == null) {
          definitiveSessionLoss = true;
          await sessionStore.clearPersistedSessionForRefresh(epoch);
        }
        sessionStore.completeRefresh(epoch, {
          ok: true,
          session: result.data ?? null,
        });
      } else {
        const status = typeof result.status === "number" ? result.status : 0;
        if (status === 401) {
          definitiveSessionLoss = true;
          await sessionStore.clearPersistedSessionForRefresh(epoch);
        }
        sessionStore.completeRefresh(epoch, {
          clearSession: status === 401,
          error: result.error ?? result,
          ok: false,
        });
      }
      return result;
    } catch (error) {
      sessionStore.completeRefresh(epoch, {
        clearSession: definitiveSessionLoss,
        error,
        ok: false,
      });
      throw error;
    }
  };

  const revokeSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: "/revoke-sessions", method: "POST" },
      input,
      options
    );

  const revokeOtherSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.executePostWithOptionalInput<AthenaAuthStatusResponse>(
      resolvedConfig,
      { endpoint: "/revoke-other-sessions", method: "POST" },
      input,
      options
    );

  const revokeSession = (
    input: { token: string } & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.executePostWithCompatibleInput<
      typeof input,
      AthenaAuthStatusResponse
    >(
      resolvedConfig,
      { endpoint: "/revoke-session", method: "POST" },
      input,
      options
    );

  const collectRevokeTokens = (
    input: Parameters<AthenaAuthBindings["session"]["revoke"]>[0]
  ): string[] => {
    if (Array.isArray(input)) {
      return input
        .map((item) =>
          typeof item === "string"
            ? item
            : typeof (item as { token?: string })?.token === "string"
              ? (item as { token: string }).token
              : ""
        )
        .filter((token) => token.trim().length > 0);
    }
    if (!input || typeof input !== "object") {
      return [];
    }
    const parsed = input as { token?: string; tokens?: string[] };
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens.filter((token) => token.trim().length > 0);
    }
    if (typeof parsed.token === "string" && parsed.token.trim().length > 0) {
      return [parsed.token];
    }
    return [];
  };

  const executeSessionRevoke: AthenaAuthBindings["session"]["revoke"] = (
    input,
    options
  ) => {
    if (Array.isArray(input)) {
      if (input.length === 0) {
        throw new Error("session.revoke requires at least one session token");
      }
      if (input.length === 1) {
        return revokeSession(input[0], options);
      }
      return revokeSessions(undefined, options);
    }

    const parsed = input as AthenaAuthGenericInput & {
      token?: string;
      tokens?: string[];
    };
    const tokens = Array.isArray(parsed.tokens)
      ? parsed.tokens.filter((token) => token.trim().length > 0)
      : undefined;

    if (tokens && tokens.length > 1) {
      return revokeSessions(
        parsed.fetchOptions ? { fetchOptions: parsed.fetchOptions } : undefined,
        options
      );
    }

    if (tokens && tokens.length === 1) {
      return revokeSession(
        { fetchOptions: parsed.fetchOptions, token: tokens[0] },
        options
      );
    }

    const token = parsed.token?.trim();
    if (!token) {
      throw new Error(
        "session.revoke requires a non-empty token or a non-empty token list"
      );
    }

    return revokeSession(
      {
        fetchOptions: parsed.fetchOptions,
        token,
      },
      options
    );
  };

  const sessionRevokeBinding: AthenaAuthBindings["session"]["revoke"] = async (
    input,
    options
  ) => {
    const tokens = collectRevokeTokens(input);
    const result = await executeSessionRevoke(input, options);
    const revokedAll =
      (Array.isArray(input) && input.length > 1) || tokens.length > 1;
    if (
      result.ok &&
      (revokedAll || sessionStore.shouldInvalidateForRevokedTokens(tokens))
    ) {
      sessionStore.invalidate("revoke");
      await sessionStore.clearPersistedSession();
    }
    return result;
  };

  const listSessions = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.getGeneric<AthenaAuthSession[]>("/list-sessions", input, options);

  const session: AthenaAuthBindings["session"] = {
    get: () => sessionStore.getSnapshot().session,
    getSnapshot: () => sessionStore.getSnapshot(),
    hydrate: (state: Parameters<typeof sessionStore.hydrate>[0]) =>
      sessionStore.hydrate(state),
    invalidate: (reason?: "signOut" | "revoke" | "manual") => {
      const generation = sessionStore.invalidate(reason);
      if (reason === "signOut") {
        sessionStore.releaseInvalidation("signOut");
      }
      return generation;
    },
    list: listSessions,
    refresh: mutations.refreshSessionStore,
    revoke: sessionRevokeBinding,
    revokeOther: revokeOtherSessions,
    setSession: (
      session: Parameters<typeof sessionStore.setSession>[0],
      status?: Parameters<typeof sessionStore.setSession>[1]
    ) => sessionStore.setSession(session, status),
    subscribe: (
      listener: (snapshot: ReturnType<typeof sessionStore.getSnapshot>) => void
    ) => sessionStore.subscribe(listener),
  };

  const error: AthenaAuthBindings["error"] = (input, options) =>
    transport.getGeneric<AthenaAuthErrorResponse | string>(
      "/error",
      input,
      options
    );
  const ok: AthenaAuthBindings["ok"] = (input, options) =>
    transport.getGeneric<AthenaAuthOkResponse>("/ok", input, options);

  return {
    error,
    getSession,
    getUser,
    health,
    listSessions,
    ok,
    requirePermission,
    requireSession,
    revokeOtherSessions,
    revokeSession,
    revokeSessions,
    session,
    sessionRevokeBinding,
    signOut,
  };
}
