import type { AthenaRightKey } from "../rights/key.ts";
import type {
  AssignedRoleSummary,
  AuthorizationCapabilities,
  AuthorizationSnapshot,
  RoleDescriptor,
} from "../runtime/authorization/types.ts";
import type {
  AthenaAuthSession,
  AthenaAuthSessionResponse,
  AthenaAuthUser,
} from "./types.ts";

/**
 * Canonical application session snapshot.
 *
 * Distinct from the transport {@link AthenaAuthSessionResponse}: organization
 * fields may be adapter-resolved (server ensureActive) and are always present.
 * Values are immutable snapshots — not live auth state.
 *
 * Runtime: top-level and known authorization collections are frozen copies.
 * User/session are shallow copies (nested unknown fields are not deep-frozen).
 */
export interface AthenaSessionData {
  readonly authorization?: AthenaSessionAuthorizationSnapshot;
  readonly grants: readonly string[];
  readonly organization: {
    readonly activeId: string | null;
    readonly rawActiveId: string | null;
  };
  readonly rights: readonly AthenaRightKey[];
  readonly session: AthenaAuthSession;
  readonly user: AthenaAuthUser;
}

/** Readonly application view of Athena's canonical authorization snapshot. */
export type AthenaSessionAuthorizationSnapshot = Readonly<
  Omit<AuthorizationSnapshot, "assignableRoles" | "capabilities" | "roles">
> & {
  readonly assignableRoles: readonly Readonly<RoleDescriptor>[];
  readonly capabilities: Readonly<AuthorizationCapabilities>;
  readonly roles: readonly Readonly<AssignedRoleSummary>[];
};

function freezeAuthorizationSnapshot(
  authorization: AuthorizationSnapshot
): AthenaSessionAuthorizationSnapshot {
  const snapshot: AthenaSessionAuthorizationSnapshot = {
    ...(authorization.activeOrganizationId === undefined
      ? {}
      : { activeOrganizationId: authorization.activeOrganizationId }),
    assignableRoles: authorization.assignableRoles.map((role) => ({ ...role })),
    capabilities: { ...authorization.capabilities },
    effectiveRights: [...authorization.effectiveRights],
    revision: authorization.revision,
    roles: authorization.roles.map((role) => ({ ...role })),
  };
  snapshot.assignableRoles.forEach(Object.freeze);
  snapshot.roles.forEach(Object.freeze);
  Object.freeze(snapshot.assignableRoles);
  Object.freeze(snapshot.capabilities);
  Object.freeze(snapshot.effectiveRights);
  Object.freeze(snapshot.roles);
  return Object.freeze(snapshot);
}

export interface ToSessionDataOptions {
  /**
   * Resolved active organization for this snapshot.
   * Defaults to `rawActiveId` (browser / no-repair path).
   */
  activeId?: string | null;
  /**
   * Pre-repair active organization from the transport session.
   * Defaults to `session.activeOrganizationId`.
   */
  rawActiveId?: string | null;
}

function normalizeId(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build a readonly {@link AthenaSessionData} from a transport session payload.
 *
 * React client adapters should leave `activeId` equal to `rawActiveId`
 * (no server-side organization repair). Next server adapters may pass a
 * repaired `activeId` after ensureActive.
 */
export function toSessionData(
  response: AthenaAuthSessionResponse,
  options: ToSessionDataOptions = {}
): AthenaSessionData {
  const rawActiveId =
    options.rawActiveId === undefined
      ? normalizeId(response.session?.activeOrganizationId)
      : normalizeId(options.rawActiveId);
  const activeId =
    options.activeId === undefined
      ? rawActiveId
      : normalizeId(options.activeId);

  const user = Object.freeze({ ...response.user });
  const session = Object.freeze({ ...response.session });
  const authorizationScopeMatches =
    activeId === rawActiveId &&
    (!response.authorization ||
      normalizeId(response.authorization.activeOrganizationId) === activeId);
  const authorization =
    authorizationScopeMatches && response.authorization
      ? freezeAuthorizationSnapshot(response.authorization)
      : undefined;
  const grants = Object.freeze([...(response.grants ?? [])]);
  const rights = Object.freeze(
    authorizationScopeMatches ? [...(response.rights ?? [])] : []
  );

  return Object.freeze({
    authorization,
    grants,
    organization: Object.freeze({
      activeId,
      rawActiveId,
    }),
    rights,
    session,
    user,
  });
}
