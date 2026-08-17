/**
 * EXAMPLE: Better Auth–style session hook for React clients.
 *
 * ```tsx
 * import { createClient } from '@xylex-group/athena'
 * import { SessionStatusPanel } from './use-session-panel'
 *
 * const athena = createClient({ url, key, auth: { url: '/api/auth' } })
 * export default function Page() {
 *   return <SessionStatusPanel authClient={athena} />
 * }
 * ```
 *
 * Accepts any of:
 * - `createClient(...)`  → uses `client.auth.getSession`
 * - `createClient(...).auth`
 * - auth-ui style `{ getSession }`
 */

import {
  type UseSessionAuthClient,
  type UseSessionOptions,
  type UseSessionResult,
  useSession,
} from "@xylex-group/athena/react";
import type { ReactElement } from "react";

export interface SessionStatusPanelProps {
  authClient: UseSessionAuthClient;
  /** Optional render prop for custom UI / tests. */
  children?: (state: UseSessionResult) => ReactElement | null;
  options?: UseSessionOptions;
}

/**
 * Default panel UI + hook wiring. Prefer the hook directly in product code;
 * this component is the copy-paste surface for docs and anti-stale tests.
 */
export function SessionStatusPanel(
  props: SessionStatusPanelProps
): ReactElement | null {
  const state = useSession(props.authClient, props.options);

  if (props.children) {
    return props.children(state);
  }

  if (state.isPending) {
    return <p data-testid="session-pending">Loading session…</p>;
  }

  if (state.error) {
    return (
      <p data-testid="session-error" role="alert">
        {state.error.message}
      </p>
    );
  }

  if (!(state.isAuthenticated && state.user)) {
    return <p data-testid="session-anonymous">Signed out</p>;
  }

  return (
    <div data-testid="session-authenticated">
      <p data-testid="session-user">{state.user.email ?? state.user.id}</p>
      <p data-testid="session-org">{state.organizationId ?? "—"}</p>
      <button
        data-testid="session-refetch"
        onClick={() => {
          void state.refetch();
        }}
        type="button"
      >
        Refresh session
      </button>
    </div>
  );
}

/**
 * Headless hook wrapper for tests that only care about return shape.
 */
export function useExampleSession(
  authClient: UseSessionAuthClient,
  options?: UseSessionOptions
): UseSessionResult {
  return useSession(authClient, options);
}
