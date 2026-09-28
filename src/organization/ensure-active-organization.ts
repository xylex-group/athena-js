/**
 * Framework-agnostic active-organization bootstrap.
 *
 * Promoted from consumer apps (e.g. speedrun-formations) so product code only
 * supplies list/set-active + optional org selection policy.
 *
 * Does not call Athena Auth routes itself — inject your client's
 * `auth.organization.list` / `setActive` (or any compatible functions).
 */

export interface ActiveOrganizationSessionLike {
  session?: {
    activeOrganizationId?: string | null;
  } | null;
}

export interface OrganizationLike {
  id: string;
}

export interface EnsureActiveOrganizationOptions<
  TOrganization extends OrganizationLike,
> {
  listOrganizations: () => Promise<readonly TOrganization[]>;
  onError?: (error: unknown) => void;
  /**
   * Choose which org to activate when the session has none.
   * Default: first organization with a non-empty `id`.
   */
  selectOrganizationId?: (
    organizations: readonly TOrganization[]
  ) => string | null;
  session: ActiveOrganizationSessionLike | null | undefined;
  setActiveOrganization: (organizationId: string) => Promise<unknown>;
}

export interface EnsureActiveOrganizationResult {
  activeOrganizationId: string | null;
  didSetActiveOrganization: boolean;
}

function normalizeOrganizationId(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function defaultSelectOrganizationId<TOrganization extends OrganizationLike>(
  organizations: readonly TOrganization[]
): string | null {
  for (const organization of organizations) {
    const id = normalizeOrganizationId(organization.id);
    if (id) {
      return id;
    }
  }
  return null;
}

/**
 * Ensure the session has an active organization when memberships exist.
 *
 * - If `session.session.activeOrganizationId` is already set → return it (no network).
 * - Else list organizations; if empty → `{ activeOrganizationId: null, didSetActiveOrganization: false }`.
 * - Else select an id (custom or first) and call `setActiveOrganization`.
 * - List/set failures invoke `onError` and return unset (never throw).
 */
export async function ensureActiveOrganization<
  TOrganization extends OrganizationLike,
>(
  options: EnsureActiveOrganizationOptions<TOrganization>
): Promise<EnsureActiveOrganizationResult> {
  const currentActiveOrganizationId = normalizeOrganizationId(
    options.session?.session?.activeOrganizationId
  );

  if (currentActiveOrganizationId) {
    return {
      activeOrganizationId: currentActiveOrganizationId,
      didSetActiveOrganization: false,
    };
  }

  let organizations: readonly TOrganization[];
  try {
    organizations = await options.listOrganizations();
  } catch (error) {
    options.onError?.(error);
    return {
      activeOrganizationId: null,
      didSetActiveOrganization: false,
    };
  }

  if (organizations.length === 0) {
    return {
      activeOrganizationId: null,
      didSetActiveOrganization: false,
    };
  }

  const selectedOrganizationId = normalizeOrganizationId(
    (options.selectOrganizationId ?? defaultSelectOrganizationId)(organizations)
  );

  if (!selectedOrganizationId) {
    return {
      activeOrganizationId: null,
      didSetActiveOrganization: false,
    };
  }

  try {
    await options.setActiveOrganization(selectedOrganizationId);
    return {
      activeOrganizationId: selectedOrganizationId,
      didSetActiveOrganization: true,
    };
  } catch (error) {
    options.onError?.(error);
    return {
      activeOrganizationId: null,
      didSetActiveOrganization: false,
    };
  }
}
