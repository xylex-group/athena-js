/**
 * Athena-session principal source.
 *
 * Uses existing Auth store primitives (getSessionByToken / getUserById / getMember).
 * Does not issue ad-hoc SQL from the data runtime.
 */
import { isUserEffectivelyBanned } from "../../auth/local/admin-contract.ts";
import { createPostgresAuthDatabase } from "../../auth/local/database.ts";
import { PostgresAuthStores } from "../../auth/local/stores.ts";
import type {
  AthenaRuntimeAuthSessionStore,
  AthenaRuntimeOrganizationVerifier,
  AthenaRuntimeSessionLookup,
  AthenaRuntimeSessionLookupFn,
} from "./principal.ts";

export function createLookupSessionFromAuthStores(
  stores: AthenaRuntimeAuthSessionStore
): AthenaRuntimeSessionLookupFn {
  return async (token) => {
    const session = await stores.getSessionByToken(token);
    if (!session) {
      return null;
    }
    const user = await stores.getUserById(session.user_id);
    if (!user) {
      return null;
    }
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
        id: user.id,
        ...(user.role ? { role: user.role } : {}),
      },
    };
    return lookup;
  };
}

export function createMembershipVerifierFromAuthStores(
  stores: AthenaRuntimeAuthSessionStore
): AthenaRuntimeOrganizationVerifier | undefined {
  if (typeof stores.getMember !== "function") {
    return undefined;
  }
  return async ({ organizationId, userId }) => {
    const member = await stores.getMember?.(organizationId, userId);
    return member != null;
  };
}

export function createDeferredPostgresAuthStores(
  databaseUrl: string
): AthenaRuntimeAuthSessionStore {
  let ready: Promise<PostgresAuthStores> | undefined;
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
  };
}
