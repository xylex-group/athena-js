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
 * Runtime: top-level object, organization, user, and session are Object.freeze'd
 * shallow copies (nested unknown fields on user/session are not deep-frozen).
 */
export interface AthenaSessionData {
  readonly organization: {
    readonly activeId: string | null;
    readonly rawActiveId: string | null;
  };
  readonly session: AthenaAuthSession;
  readonly user: AthenaAuthUser;
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
    options.rawActiveId !== undefined
      ? normalizeId(options.rawActiveId)
      : normalizeId(response.session?.activeOrganizationId);
  const activeId =
    options.activeId !== undefined
      ? normalizeId(options.activeId)
      : rawActiveId;

  const user = Object.freeze({ ...response.user });
  const session = Object.freeze({ ...response.session });

  return Object.freeze({
    organization: Object.freeze({
      activeId,
      rawActiveId,
    }),
    session,
    user,
  });
}
