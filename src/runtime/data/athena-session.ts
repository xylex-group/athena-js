/**
 * Athena-session principal source.
 *
 * Uses existing Auth store primitives (getSessionByToken / getUserById / getMember).
 * Does not issue ad-hoc SQL from the data runtime.
 */
import { isUserEffectivelyBanned } from "../../auth/local/admin-contract.ts";
import { createPostgresAuthDatabase } from "../../auth/local/database.ts";
import type { AuthMemberRow } from "../../auth/local/models.ts";
import { PostgresAuthStores } from "../../auth/local/stores.ts";
import { AthenaConfigurationError } from "../../config/errors.ts";
import {
  compareAuthorizationShadow,
  hasLegacyRoleMap,
} from "../authorization/shadow.ts";
import {
  type AthenaAuthorizationStore,
  isPersistedAuthorizationStore,
} from "../authorization/store.ts";
import type {
  AthenaPrincipalRightsProjection,
  AthenaRuntimeAuthConfig,
  AthenaRuntimeAuthSessionStore,
  AthenaRuntimeJwtVerifier,
  AthenaRuntimeOrganizationVerifier,
  AthenaRuntimeSessionLookup,
  AthenaRuntimeSessionLookupFn,
} from "./principal.ts";
import {
  ATHENA_PERSISTED_AUTHORIZATION_RESOLUTION_KIND,
  type AthenaRightsResolution,
  effectiveRightsFromResolution,
  emitAthenaPersistedAuthorizationDiagnostic,
  resolveStoredUserRightsResolution,
  validateAthenaRightsProjection,
} from "./rights-resolution.ts";

export type { AthenaRightsResolution } from "./rights-resolution.ts";

export class AthenaAuthorizationResolutionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AthenaAuthorizationResolutionError";
  }
}

/** Create a lookup session from auth stores. */
export function createLookupSessionFromAuthStores(
  stores: AthenaRuntimeAuthSessionStore,
  options?: { authorization?: AthenaPrincipalRightsProjection }
): AthenaRuntimeSessionLookupFn {
  assertStrictRoleProjection(options?.authorization);
  const useLegacyRoleMap = hasLegacyRoleMap(options?.authorization);
  return async (token) => {
    const session = await stores.getSessionByToken(token);
    if (!session) {
      return null;
    }
    const user = await stores.getUserById(session.user_id);
    if (!user) {
      return null;
    }
    let rights: readonly string[];
    if (useLegacyRoleMap) {
      const assigned = await resolveAssignedRightsCompat(
        stores,
        user.id,
        session.active_organization_id
      );
      const resolution = resolveStoredUserRightsResolution(
        user,
        options?.authorization,
        { userId: user.id }
      );
      rights = effectiveRightsFromResolution(resolution);
      if (assigned !== undefined) {
        compareAuthorizationShadow({
          assignedRights: assigned,
          legacyRights: rights,
          userId: user.id,
        });
      }
    } else {
      const assigned = await resolveAssignedRightsAuthoritative(
        stores,
        user.id,
        session.active_organization_id
      );
      rights = assigned ?? [];
    }
    const grants = Array.isArray(user.grants)
      ? user.grants.map((entry) => String(entry))
      : [];
    const lookup: AthenaRuntimeSessionLookup = {
      session: {
        activeOrganizationId: session.active_organization_id ?? null,
        expiresAt: session.expires_at,
        id: session.id,
        revoked: session.active === false,
        userId: session.user_id,
      },
      user: {
        banned: isUserEffectivelyBanned(user),
        ...(grants.length > 0 ? { grants } : {}),
        id: user.id,
        ...(rights.length > 0 ? { rights } : {}),
        ...(user.role ? { role: user.role } : {}),
      },
    };
    return lookup;
  };
}

export function resolveStoredUserRights(
  user: {
    metadata?: unknown;
    rights?: readonly string[];
    role?: string | null;
  },
  authorization?: AthenaPrincipalRightsProjection
): AthenaRightsResolution {
  return resolveStoredUserRightsResolution(user, authorization);
}

export function createAthenaSessionAuthFromStores(input: {
  authorization?: AthenaPrincipalRightsProjection;
  getStores: () => Promise<AthenaRuntimeAuthSessionStore>;
  jwtVerifier?: AthenaRuntimeJwtVerifier;
}): Extract<AthenaRuntimeAuthConfig, { mode: "athena-session" }> {
  assertStrictRoleProjection(input.authorization);
  return {
    ...(input.jwtVerifier ? { jwtVerifier: input.jwtVerifier } : {}),
    lookupSession: async (token) => {
      const stores = await input.getStores();
      return createLookupSessionFromAuthStores(stores, {
        authorization: input.authorization,
      })(token);
    },
    mode: "athena-session",
  };
}

export function readAuthRightsProjection(
  config: unknown
): AthenaPrincipalRightsProjection | undefined {
  if (!config || typeof config !== "object") {
    return;
  }
  const auth = (config as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object") {
    return;
  }
  const authorization = (auth as { authorization?: unknown }).authorization;
  if (!authorization || typeof authorization !== "object") {
    return;
  }
  const record = authorization as AthenaPrincipalRightsProjection;
  return {
    ...(typeof record.defaultRole === "string"
      ? { defaultRole: record.defaultRole }
      : {}),
    ...(record.mode === "role" || record.mode === "stored"
      ? { mode: record.mode }
      : {}),
    ...(record.rightsByRole ? { rightsByRole: record.rightsByRole } : {}),
    ...(record.strictRoles === true ? { strictRoles: true } : {}),
  };
}

function assertStrictRoleProjection(
  authorization: AthenaPrincipalRightsProjection | undefined
): void {
  if (authorization?.strictRoles !== true) {
    return;
  }
  const projection = validateAthenaRightsProjection(authorization);
  const first = projection.issues[0];
  if (!projection.ok && first) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `ATHENA_AUTH_CONFIG_INVALID: ${first.message}`,
      "auth"
    );
  }
}

/** Create a membership verifier from auth stores. */
export function createMembershipVerifierFromAuthStores(
  stores: AthenaRuntimeAuthSessionStore
): AthenaRuntimeOrganizationVerifier | undefined {
  if (typeof stores.getMember !== "function") {
    return;
  }
  return async ({ organizationId, userId }) => {
    const member = await stores.getMember?.(organizationId, userId);
    return member != null;
  };
}

type DeferredPostgresAuthBacking = {
  authorization: AthenaAuthorizationStore;
  getMember(
    organizationId: string,
    userId: string
  ): Promise<AuthMemberRow | undefined>;
  getSessionByToken: AthenaRuntimeAuthSessionStore["getSessionByToken"];
  getUserById: AthenaRuntimeAuthSessionStore["getUserById"];
};

/** Create deferred Postgres auth stores. */
export function createDeferredPostgresAuthStores(
  databaseUrl: string
): AthenaRuntimeAuthSessionStore {
  let ready: Promise<DeferredPostgresAuthBacking> | undefined;
  const resolve = () => {
    ready ??= (async () => {
      const database = await createPostgresAuthDatabase(databaseUrl);
      return new PostgresAuthStores(database);
    })();
    return ready;
  };
  return {
    async getMember(organizationId, userId) {
      const stores = await resolve();
      return stores.getMember(organizationId, userId);
    },
    async getSessionByToken(token) {
      const stores = await resolve();
      return stores.getSessionByToken(token);
    },
    async getUserById(id) {
      const stores = await resolve();
      return stores.getUserById(id);
    },
    async hasAuthorizationAssignment(userId) {
      const stores = await resolve();
      return stores.authorization.hasUserAssignment(userId);
    },
    async resolveEffectiveRights(input) {
      const stores = await resolve();
      const rights = await stores.authorization.resolveEffectiveRights({
        activeOrganizationId: input.activeOrganizationId,
        getMember: (organizationId, userId) =>
          stores.getMember(organizationId, userId),
        userId: input.userId,
      });
      return [...rights];
    },
  };
}

async function resolveAssignedRightsCompat(
  stores: AthenaRuntimeAuthSessionStore,
  userId: string,
  activeOrganizationId?: string | null
): Promise<readonly string[] | undefined> {
  try {
    return await resolveAssignedRightsOrThrow(
      stores,
      userId,
      activeOrganizationId
    );
  } catch (error) {
    const assignment = await assignmentPresence(stores, userId);
    emitAthenaPersistedAuthorizationDiagnostic({
      assignment,
      error: errorMessage(error),
      fallback: "legacy-role-map",
      kind: ATHENA_PERSISTED_AUTHORIZATION_RESOLUTION_KIND,
      resolution: "failed",
      source: "persisted",
      userId,
    });
  }
}

async function resolveAssignedRightsAuthoritative(
  stores: AthenaRuntimeAuthSessionStore,
  userId: string,
  activeOrganizationId?: string | null
): Promise<readonly string[] | undefined> {
  try {
    return await resolveAssignedRightsOrThrow(
      stores,
      userId,
      activeOrganizationId
    );
  } catch (error) {
    const assignment = await assignmentPresence(stores, userId);
    emitAthenaPersistedAuthorizationDiagnostic({
      assignment,
      error: errorMessage(error),
      fallback: "forbidden",
      kind: ATHENA_PERSISTED_AUTHORIZATION_RESOLUTION_KIND,
      resolution: "failed",
      source: "persisted",
      userId,
    });
    throw new AthenaAuthorizationResolutionError(
      "Persisted authorization resolution failed.",
      { cause: error }
    );
  }
}

async function resolveAssignedRightsOrThrow(
  stores: AthenaRuntimeAuthSessionStore,
  userId: string,
  activeOrganizationId?: string | null
): Promise<readonly string[] | undefined> {
  if (typeof stores.resolveEffectiveRights !== "function") {
    const authorization = authorizationFromUnknownStore(stores);
    if (!authorization) {
      return;
    }
    const hasAssignment = await authorization.hasUserAssignment(userId);
    if (!hasAssignment) {
      return;
    }
    const getMember = stores.getMember;
    if (typeof getMember !== "function") {
      return [
        ...(await authorization.resolveEffectiveRights({
          activeOrganizationId,
          getMember: async () => undefined,
          userId,
        })),
      ];
    }
    return [
      ...(await authorization.resolveEffectiveRights({
        activeOrganizationId,
        getMember: async (organizationId, memberUserId) => {
          const member = await getMember(organizationId, memberUserId);
          return member as AuthStoreMemberLookupRow | undefined;
        },
        userId,
      })),
    ];
  }
  const hasAssignment = await stores.hasAuthorizationAssignment?.(userId);
  if (hasAssignment === false) {
    return;
  }
  return stores.resolveEffectiveRights({
    activeOrganizationId,
    userId,
  });
}

export function authorizationFromUnknownStore(
  stores: AthenaRuntimeAuthSessionStore
): AthenaAuthorizationStore | undefined {
  if (!("authorization" in stores)) {
    return;
  }
  const candidate = (stores as { authorization?: unknown }).authorization;
  if (!isPersistedAuthorizationStore(candidate)) {
    return;
  }
  return candidate;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

async function assignmentPresence(
  stores: AthenaRuntimeAuthSessionStore,
  userId: string
): Promise<"present" | "absent" | "unknown"> {
  if (typeof stores.hasAuthorizationAssignment !== "function") {
    return "unknown";
  }
  try {
    const hasAssignment = await stores.hasAuthorizationAssignment(userId);
    if (hasAssignment === true) {
      return "present";
    }
    if (hasAssignment === false) {
      return "absent";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

type AuthStoreMemberLookupRow = {
  created_at: Date | string;
  id: string;
  organization_id: string;
  role: string;
  user_id: string;
};
