import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AthenaAdminPermissionCheckInput,
  type AthenaAdminSessionLike,
  hasAdminPermission,
  resolveAdminPermissionClient,
} from "../admin/index.ts";
import type { AthenaAdminHasPermissionRequest } from "../auth/types.ts";
import {
  type UseSessionAuthClient,
  type UseSessionOptions,
  useSession,
} from "./use-session.ts";

const DEFAULT_ADMIN_PERMISSIONS = [
  "admin:read",
] as AthenaAdminHasPermissionRequest["permissions"];

export interface UseAdminPermissionOptions {
  allowRoleBypass?: boolean;
  enabled?: boolean;
  fetchOptions?: AthenaAdminPermissionCheckInput["fetchOptions"];
  permission?: AthenaAdminHasPermissionRequest["permission"];
  /**
   * Permission set checked via `client.auth.admin.hasPermission`.
   * Defaults to `["admin:read"]`.
   */
  permissions?: AthenaAdminHasPermissionRequest["permissions"];
  requestOptions?: AthenaAdminPermissionCheckInput["requestOptions"];
  /**
   * When provided, skips the internal session fetch.
   * Pass `null` to force a denied result without calling getSession.
   */
  session?: AthenaAdminSessionLike | null;
  /** Forwarded to the internal `useSession` when `session` is omitted. */
  sessionOptions?: Omit<UseSessionOptions, "enabled">;
}

export interface UseAdminPermissionResult {
  allowed: boolean;
  error: Error | null;
  isPending: boolean;
  refetch: () => Promise<boolean>;
  session: AthenaAdminSessionLike | null;
}

type AdminPermissionAuthClient = UseSessionAuthClient & {
  auth?: { admin?: unknown };
  admin?: unknown;
};

function serializePermissions(
  permissions: AthenaAdminHasPermissionRequest["permissions"] | undefined,
  permission: AthenaAdminHasPermissionRequest["permission"] | undefined
) {
  return JSON.stringify({
    permission: permission ?? null,
    permissions: permissions ?? DEFAULT_ADMIN_PERMISSIONS,
  });
}

/**
 * React gate for Athena admin permissions.
 *
 * Uses {@link hasAdminPermission} from `@xylex-group/athena/admin` with an
 * optional local `admin` role short-circuit. When `session` is omitted, loads
 * the current session through {@link useSession}.
 *
 * @example
 * ```tsx
 * const athena = createClient({ url, key, auth: { url: "/api/auth" } })
 * const { allowed, isPending } = useAdminPermission(athena, {
 *   permissions: ["admin:read"],
 * })
 * ```
 */
export function useAdminPermission(
  client: AdminPermissionAuthClient | null | undefined,
  options: UseAdminPermissionOptions = {}
): UseAdminPermissionResult {
  const enabled = options.enabled ?? true;
  const sessionProvided = "session" in options;
  const sessionFromOptions = sessionProvided
    ? (options.session ?? null)
    : undefined;
  const permissionsKey = serializePermissions(
    options.permissions,
    options.permission
  );
  const allowRoleBypass = options.allowRoleBypass;
  const fetchOptions = options.fetchOptions;
  const requestOptions = options.requestOptions;

  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sessionState = useSession(client as UseSessionAuthClient, {
    ...options.sessionOptions,
    enabled: enabled && !sessionProvided && !!client,
  });

  const session: AthenaAdminSessionLike | null = sessionProvided
    ? (sessionFromOptions ?? null)
    : (sessionState.data as AthenaAdminSessionLike | null);

  const sessionPending = !sessionProvided && sessionState.isPending;
  const sessionUserId = session?.user?.id ?? null;
  const sessionRole = session?.user?.role ?? null;

  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isChecking, setIsChecking] = useState(enabled);
  const requestIdRef = useRef(0);
  const mountedRef = useRef(true);

  const runCheck = useCallback(async (): Promise<boolean> => {
    const requestId = ++requestIdRef.current;
    const current = optionsRef.current;
    const permissions = current.permissions ?? DEFAULT_ADMIN_PERMISSIONS;

    if (!(enabled && client)) {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setAllowed(false);
        setError(null);
        setIsChecking(false);
      }
      return false;
    }

    setIsChecking(true);

    try {
      const permissionClient = resolveAdminPermissionClient(client);
      if (!permissionClient) {
        throw new Error(
          "useAdminPermission requires an Athena client with auth.admin (createClient(...) or auth bindings)"
        );
      }

      const resolvedSession = sessionProvided
        ? (current.session ?? null)
        : (sessionState.data as AthenaAdminSessionLike | null);

      const nextAllowed = await hasAdminPermission(permissionClient, {
        allowRoleBypass: current.allowRoleBypass,
        fetchOptions: current.fetchOptions,
        permission: current.permission,
        permissions,
        requestOptions: current.requestOptions,
        session: resolvedSession,
      });

      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return nextAllowed;
      }

      setAllowed(nextAllowed);
      setError(null);
      return nextAllowed;
    } catch (checkError) {
      if (!mountedRef.current || requestId !== requestIdRef.current) {
        return false;
      }

      const nextError =
        checkError instanceof Error
          ? checkError
          : new Error("Failed to resolve admin permission");
      setAllowed(false);
      setError(nextError);
      return false;
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setIsChecking(false);
      }
    }
  }, [client, enabled, sessionProvided, sessionState.data]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setAllowed(false);
      setError(null);
      setIsChecking(false);
      return;
    }

    if (!sessionProvided && sessionState.isPending) {
      setIsChecking(true);
      return;
    }

    void runCheck();
  }, [
    allowRoleBypass,
    enabled,
    fetchOptions,
    permissionsKey,
    requestOptions,
    runCheck,
    sessionPending,
    sessionProvided,
    sessionRole,
    sessionUserId,
  ]);

  const refetch = useCallback(async () => {
    if (!sessionProvided) {
      await sessionState.refetch();
    }
    return await runCheck();
  }, [runCheck, sessionProvided, sessionState]);

  return {
    allowed,
    error,
    isPending: enabled && (sessionPending || isChecking),
    refetch,
    session,
  };
}
