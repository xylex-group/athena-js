/**
 * EXAMPLE: Canonical session snapshot APIs.
 *
 * - {@link toSessionData} — transport → frozen AthenaSessionData
 * - {@link deriveSessionView} — convenience fields (isAuthenticated, org id, …)
 *
 * Browser path: leave `activeId === rawActiveId` (no ensureActive repair).
 * Server path: pass repaired `activeId` after organization ensureActive.
 */

import type {
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthUser,
} from "@xylex-group/athena";
import {
  type AthenaSessionData,
  type DerivedSessionView,
  deriveSessionView,
  toSessionData,
} from "@xylex-group/athena/react";

/** Minimal transport payload used by docs + tests. */
export function createExampleAuthSessionResponse(
  overrides: {
    userId?: string;
    sessionId?: string;
    email?: string;
    activeOrganizationId?: string | null;
    token?: string;
  } = {}
): AthenaAuthSessionResponse {
  const user = {
    email: overrides.email ?? "ada@example.com",
    id: overrides.userId ?? "user_ada",
    name: "Ada",
  } as AthenaAuthUser;
  const session = {
    activeOrganizationId: overrides.activeOrganizationId ?? "org_demo",
    id: overrides.sessionId ?? "sess_1",
    token: overrides.token ?? "token_example",
  } as AthenaAuthSession;
  return { session, user };
}

/**
 * Browser / client adapter path: no organization repair.
 * `activeId` mirrors the transport `activeOrganizationId`.
 */
export function exampleBrowserSessionSnapshot(
  response: AthenaAuthSessionResponse = createExampleAuthSessionResponse()
): AthenaSessionData {
  return toSessionData(response);
}

/**
 * Server adapter path after ensureActive / product resolveActiveOrganizationId.
 * Keeps raw transport id separate from the repaired active id.
 */
export function exampleServerRepairedSessionSnapshot(
  response: AthenaAuthSessionResponse = createExampleAuthSessionResponse(),
  repairedActiveId = "org_repaired"
): AthenaSessionData {
  return toSessionData(response, {
    activeId: repairedActiveId,
    rawActiveId: response.session?.activeOrganizationId ?? null,
  });
}

/**
 * Derive UI-friendly fields from either transport or normalized session data.
 */
export function exampleSessionView(
  data: AthenaAuthSessionResponse | AthenaSessionData | null
): DerivedSessionView<AthenaSessionData | null> {
  return deriveSessionView(data);
}

/** Small pure helper apps can copy for gate checks. */
export function exampleRequireAuthenticatedView(
  data: AthenaAuthSessionResponse | AthenaSessionData | null
): DerivedSessionView<AthenaSessionData | null> {
  const view = deriveSessionView(data);
  if (!(view.isAuthenticated && view.data)) {
    throw new Error("Not authenticated");
  }
  return view;
}
