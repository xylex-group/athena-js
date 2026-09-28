import type { AthenaAuthSessionController } from "../session-controller.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthResult,
  AthenaAuthSessionResponse,
  AthenaAuthUser,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";
import {
  readAuthSessionToken,
} from "./session-persistence.ts";

export interface AuthSessionMutationController {
  applyAuthMutationToSessionStore: <T>(
    result: AthenaAuthResult<T>,
    options?: {
      refreshIfMissing?: boolean;
      persistenceGeneration?: number;
    }
  ) => Promise<AthenaAuthResult<T>>;
  fetchSessionResult: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthSessionResponse>>;
  isSessionResponse: (value: unknown) => value is AthenaAuthSessionResponse;
  patchActiveOrganization: (
    organizationId: string | null | undefined
  ) => boolean;
  refreshSessionStore: (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<
    ReturnType<
      AthenaAuthSessionController<AthenaAuthSessionResponse>["getSnapshot"]
    >
  >;
  sessionStore: AthenaAuthSessionController<AthenaAuthSessionResponse>;
}

export function isSessionResponse(
  value: unknown
): value is AthenaAuthSessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const session = record.session;
  const user = record.user;
  return (
    !!session &&
    typeof session === "object" &&
    typeof (session as { id?: unknown }).id === "string" &&
    !!user &&
    typeof user === "object" &&
    typeof (user as { id?: unknown }).id === "string"
  );
}

export function sessionFromSignIn(
  value: unknown
): AthenaAuthSessionResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record.redirect === true) {
    return null;
  }
  const user = record.user;
  const token = record.token;
  if (
    !user ||
    typeof user !== "object" ||
    typeof (user as { id?: unknown }).id !== "string"
  ) {
    return null;
  }
  const userId = (user as { id: string }).id;
  const sessionToken = typeof token === "string" ? token : undefined;
  return {
    grants: [],
    rights: [],
    session: {
      id: sessionToken ?? `local:${userId}`,
      token: sessionToken,
      userId,
    },
    user: user as AthenaAuthUser,
  };
}

export function createAuthSessionMutations(input: {
  sessionStore: AthenaAuthSessionController<AthenaAuthSessionResponse>;
  transport: AuthTransport;
}): AuthSessionMutationController {
  const { sessionStore, transport } = input;

  const fetchSessionResult = (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) =>
    transport.getGeneric<AthenaAuthSessionResponse>(
      "/get-session",
      input,
      options
    );

  const refreshSessionStore = async (
    input?: AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => {
    const { epoch, skipped } = sessionStore.beginRefresh();
    if (skipped) {
      return sessionStore.getSnapshot();
    }
    let result: AthenaAuthResult<AthenaAuthSessionResponse>;
    try {
      result = await fetchSessionResult(input, options);
    } catch (error) {
      sessionStore.completeRefresh(epoch, {
        clearSession: false,
        error,
        ok: false,
      });
      return sessionStore.getSnapshot();
    }
    if (result.ok) {
      try {
        const token = readAuthSessionToken(result.data);
        if (token) {
          await sessionStore.persistSessionTokenForRefresh(epoch, token);
        } else if (result.data == null) {
          await sessionStore.clearPersistedSessionForRefresh(epoch);
        }
      } catch (error) {
        sessionStore.completeRefresh(epoch, {
          clearSession: true,
          error,
          ok: false,
        });
        throw error;
      }
      sessionStore.completeRefresh(epoch, {
        ok: true,
        session: result.data ?? null,
      });
    } else {
      const status = typeof result.status === "number" ? result.status : 0;
      if (status === 401) {
        try {
          await sessionStore.clearPersistedSessionForRefresh(epoch);
        } catch (error) {
          sessionStore.completeRefresh(epoch, {
            clearSession: true,
            error,
            ok: false,
          });
          throw error;
        }
      }
      sessionStore.completeRefresh(epoch, {
        clearSession: status === 401,
        error: result.error ?? result,
        ok: false,
      });
    }
    return sessionStore.getSnapshot();
  };

  const applyAuthMutationToSessionStore = async <T>(
    result: AthenaAuthResult<T>,
    options?: {
      refreshIfMissing?: boolean;
      persistenceGeneration?: number;
    }
  ): Promise<AthenaAuthResult<T>> => {
    if (!result.ok) {
      return result;
    }
    if (isSessionResponse(result.data)) {
      const token = readAuthSessionToken(result.data);
      const persistenceGeneration =
        options?.persistenceGeneration ??
        sessionStore.getPersistenceGeneration();
      if (token) {
        await sessionStore.persistSessionTokenAtGeneration(
          token,
          persistenceGeneration
        );
        if (
          !sessionStore.isPersistenceGenerationCurrent(persistenceGeneration)
        ) {
          return result;
        }
      }
      sessionStore.accept(result.data);
      return result;
    }
    const fromSignIn = sessionFromSignIn(result.data);
    if (fromSignIn) {
      const token = readAuthSessionToken(fromSignIn);
      const persistenceGeneration =
        options?.persistenceGeneration ??
        sessionStore.getPersistenceGeneration();
      if (token) {
        await sessionStore.persistSessionTokenAtGeneration(
          token,
          persistenceGeneration
        );
        if (
          !sessionStore.isPersistenceGenerationCurrent(persistenceGeneration)
        ) {
          return result;
        }
      }
      sessionStore.accept(fromSignIn);
      return result;
    }
    if (options?.refreshIfMissing !== false) {
      await refreshSessionStore();
    }
    return result;
  };

  const patchActiveOrganization = (
    organizationId: string | null | undefined
  ) => {
    const current = sessionStore.getSnapshot().session;
    if (!current?.session) {
      return false;
    }
    sessionStore.accept({
      ...current,
      organization: {
        activeId: organizationId === undefined ? null : organizationId,
      },
      session: {
        ...current.session,
        activeOrganizationId:
          organizationId === undefined ? null : organizationId,
      },
    } as typeof current);
    return true;
  };

  return {
    applyAuthMutationToSessionStore,
    fetchSessionResult,
    isSessionResponse,
    patchActiveOrganization,
    refreshSessionStore,
    sessionStore,
  };
}
