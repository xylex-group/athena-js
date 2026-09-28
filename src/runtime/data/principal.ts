/**
 * Canonical Local Runtime caller identity (type SSOT).
 *
 * HTTP request → AthenaResolvedPrincipal lives in `src/runtime/authority/`.
 * One semantic principal for Auth, Policy, and execution context.
 * Authority (how it was obtained) is tracked separately so a `userId`
 * is never treated as trusted on its own. Do not add a second principal model.
 */

import {
  type AthenaRightKey,
  tryParseAthenaRightKey,
} from "../../rights/key.ts";
import {
  type AthenaMalformedRightsSource,
  emitAthenaMalformedRightsDiagnostic,
} from "./rights-diagnostics.ts";

export type {
  AthenaMalformedRightsDiagnostic,
  AthenaMalformedRightsSource,
} from "./rights-diagnostics.ts";
export {
  ATHENA_MALFORMED_RIGHTS_KIND,
  subscribeAthenaMalformedRightsDiagnostics,
} from "./rights-diagnostics.ts";

export interface AthenaPrincipal {
  authenticated: boolean;
  claims?: Readonly<Record<string, unknown>>;
  /** Legacy provenance; never used to satisfy Right checks. */
  grants: readonly string[];
  organizationId?: string;
  oauth?: AthenaOAuthPrincipalContext;
  rights: readonly AthenaRightKey[];
  role?: string;
  service?: string;
  sessionId?: string;
  tenantId?: string;
  userId?: string;
}

export interface AthenaOAuthPrincipalContext {
  clientId: string;
  grantId: string;
  resource: string;
  scopes: readonly string[];
}

/** Wire / session input. `rights` stays a string array at JSON edges. */
export type AthenaPrincipalInput = Omit<
  AthenaPrincipal,
  "rights" | "grants"
> & {
  grants?: readonly string[];
  rights?: readonly string[];
};

/**
 * Role → Rights projection at session lookup. Not a second Rights catalog.
 * Invalid keys are dropped by {@link normalizeAthenaPrincipal}.
 */
export interface AthenaPrincipalRightsProjection {
  defaultRole?: string;
  /**
   * @deprecated Compatibility only. Prefer persisted authorization assignments.
   * `role`: project `user.role` / `defaultRole` through `rightsByRole`.
   * `stored`: persist `user.rights` / `metadata.rights` only. The two modes
   * never mix. Do not add new `role` consumers.
   */
  mode?: "role" | "stored";
  /**
   * @deprecated Compatibility projection only. Product SSOT is persisted
   * `authorization_*` assignments. Do not add new `rightsByRole` consumers.
   */
  rightsByRole?: Readonly<Record<string, readonly string[]>>;
  /** Fail closed at client construction when the role table is incomplete. */
  strictRoles?: boolean;
}

export type AthenaPrincipalAuthority =
  | "anonymous"
  | "athena-session"
  | "custom-trusted"
  | "service"
  | "jwt";

export interface AthenaResolvedPrincipal {
  authority: AthenaPrincipalAuthority;
  principal: AthenaPrincipal;
}

export interface AthenaPrincipalResolutionInput {
  headers: Headers;
  request?: Request;
  requestId?: string;
}

export type AthenaPrincipalResolver = (
  input: AthenaPrincipalResolutionInput
) => Promise<AthenaResolvedPrincipal | null> | AthenaResolvedPrincipal | null;

/** Trusted session lookup result. Never constructed from request identity headers. */
export interface AthenaRuntimeSessionLookup {
  session: {
    activeOrganizationId?: string | null;
    expiresAt?: string | Date | null;
    id: string;
    revoked?: boolean;
    userId?: string;
  };
  user: {
    banned?: boolean;
    grants?: readonly string[];
    id: string;
    rights?: readonly string[];
    role?: string | null;
  };
}

export type AthenaRuntimeOrganizationVerifier = (input: {
  organizationId: string;
  userId: string;
}) => boolean | Promise<boolean>;

export type AthenaRuntimeJwtVerifier = (input: {
  headers: Headers;
  request?: Request;
  requestId?: string;
}) =>
  | Promise<AthenaResolvedPrincipal | null>
  | AthenaResolvedPrincipal
  | null;

/**
 * Duck-typed Athena Auth store surface used by `{ mode: "athena-session" }`.
 * Implemented by MemoryAuthStores / PostgresAuthStores. Not a second principal model.
 */
export interface AthenaRuntimeAuthSessionStore {
  getMember?(organizationId: string, userId: string): Promise<unknown>;
  getSessionByToken(token: string): Promise<
    | {
        active?: boolean;
        active_organization_id?: string | null;
        expires_at?: Date | string;
        id: string;
        user_id: string;
      }
    | undefined
  >;
  getUserById(id: string): Promise<
    | {
        ban_expires?: Date | string | null;
        banned?: boolean | null;
        grants?: readonly string[];
        id: string;
        metadata?: Record<string, unknown> | string | null;
        rights?: readonly string[];
        role?: string | null;
      }
    | undefined
  >;
  hasAuthorizationAssignment?(userId: string): Promise<boolean>;
  resolveEffectiveRights?(input: {
    activeOrganizationId?: string | null;
    userId: string;
  }): Promise<readonly string[]>;
}

export type AthenaRuntimeSessionLookupFn = (
  token: string
) =>
  | Promise<AthenaRuntimeSessionLookup | null>
  | AthenaRuntimeSessionLookup
  | null;

export type AthenaRuntimeAuthConfig =
  | false
  | {
      authorization?: AthenaPrincipalRightsProjection;
      lookupSession?: AthenaRuntimeSessionLookupFn;
      mode: "athena-session";
      stores?: AthenaRuntimeAuthSessionStore;
      jwtVerifier?: AthenaRuntimeJwtVerifier;
      verifyOrganizationMembership?: AthenaRuntimeOrganizationVerifier;
    }
  | {
      mode: "jwt";
      verifyToken: AthenaRuntimeJwtVerifier;
    }
  | {
      mode: "custom";
      resolvePrincipal: AthenaPrincipalResolver;
    }
  | {
      mode: "service";
      principal: AthenaPrincipalInput;
    };

export type AthenaRuntimeAuthMaterial =
  | { mode: false }
  | {
      lookupSession: AthenaRuntimeSessionLookupFn;
      jwtVerifier?: AthenaRuntimeJwtVerifier;
      mode: "athena-session";
      verifyOrganizationMembership?: AthenaRuntimeOrganizationVerifier;
    }
  | {
      mode: "jwt";
      verifyToken: AthenaRuntimeJwtVerifier;
    }
  | {
      mode: "custom";
      resolvePrincipal: AthenaPrincipalResolver;
    }
  | {
      mode: "service";
      principal: AthenaPrincipal;
    };

export function anonymousAthenaPrincipal(): AthenaPrincipal {
  return {
    authenticated: false,
    grants: Object.freeze([]),
    rights: Object.freeze([]),
  };
}

export function anonymousResolvedPrincipal(): AthenaResolvedPrincipal {
  return {
    authority: "anonymous",
    principal: anonymousAthenaPrincipal(),
  };
}

function parsePrincipalRights(
  raw: readonly string[] | undefined,
  source: AthenaMalformedRightsSource
): readonly AthenaRightKey[] {
  const parsed: AthenaRightKey[] = [];
  let malformedKeyCount = 0;
  for (const item of raw ?? []) {
    if (typeof item !== "string") {
      malformedKeyCount += 1;
      continue;
    }
    const key = tryParseAthenaRightKey(item);
    if (key === undefined) {
      malformedKeyCount += 1;
      continue;
    }
    parsed.push(key);
  }
  emitAthenaMalformedRightsDiagnostic(source, malformedKeyCount);
  return Object.freeze(parsed);
}

export function normalizeAthenaPrincipal(
  principal: AthenaPrincipalInput,
  options?: { source?: AthenaMalformedRightsSource }
): AthenaPrincipal {
  return {
    authenticated: principal.authenticated === true,
    ...(principal.userId ? { userId: principal.userId } : {}),
    ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    ...(principal.organizationId
      ? { organizationId: principal.organizationId }
      : {}),
    ...(principal.oauth
      ? {
          oauth: Object.freeze({
            clientId: principal.oauth.clientId,
            grantId: principal.oauth.grantId,
            resource: principal.oauth.resource,
            scopes: Object.freeze([...principal.oauth.scopes]),
          }),
        }
      : {}),
    ...(principal.tenantId ? { tenantId: principal.tenantId } : {}),
    ...(principal.role ? { role: principal.role } : {}),
    grants: Object.freeze([...(principal.grants ?? [])]),
    rights: parsePrincipalRights(
      principal.rights,
      options?.source ?? "principal"
    ),
    ...(principal.service ? { service: principal.service } : {}),
    ...(principal.claims
      ? { claims: Object.freeze({ ...principal.claims }) }
      : {}),
  };
}
