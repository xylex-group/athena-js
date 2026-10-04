import type { NormalizedAthenaAuthConfig } from "../config.ts";
import type { AuthDomainMutate } from "../hooks/execute.ts";
import { sanitizeHookSession, sanitizeHookUser } from "../hooks/sanitize.ts";
import {
  splitPrimaryAndRest,
  toAuthSessionRevokeReceipt,
} from "../observability/snapshots.ts";
import {
  ATHENA_AUTH_ADMIN_PATHS,
  type AthenaAuthAdminStore,
  canActOnAdminTarget,
  canAssignRole,
  normalizeAdminRole,
} from "./admin-contract.ts";
import { requireAthenaAdmin } from "./admin-guard.ts";
import {
  type IssueSessionAuthentication,
  impersonationAuthenticationFromActor,
  restoredAuthenticationFromImpersonation,
} from "./authentication-context.ts";
import { createSessionCookieHeader, shouldSetSecureCookie } from "./cookies.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { toPublicSession, toPublicUser } from "./models.ts";
import type { AthenaAuthPasswordHasher } from "./password.ts";
import { validatePassword, withPasswordHash } from "./password.ts";
import {
  asStringField,
  readJsonBody,
  requestClientIp,
  requireStringField,
} from "./security.ts";

export interface AdminRouteContext {
  config: NormalizedAthenaAuthConfig;
  hasher: AthenaAuthPasswordHasher;
  headers: Headers;
  hookRequest: (
    request: Request,
    path: string
  ) => {
    ipAddress?: string;
    method: string;
    path: string;
    userAgent?: string;
  };
  issueSession: (
    request: Request,
    stores: AthenaAuthStores,
    userId: string,
    authentication: IssueSessionAuthentication
  ) => Promise<AuthSessionRow>;
  listSessionsForUser?: (userId: string) => Promise<AuthSessionRow[]>;
  mutate: AuthDomainMutate;
  requireSession: (request: Request) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  }>;
  revokeBridgeCodesForUser?: (
    userId: string,
    exceptToken?: string
  ) => Promise<void>;
  store: AthenaAuthAdminStore;
  traceId: string;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function requireAdmin(
  request: Request,
  ctx: AdminRouteContext
): Promise<{ session: AuthSessionRow; token: string; user: AuthUserRow }> {
  return requireAthenaAdmin(request, ctx.requireSession);
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) {
    return;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
}

function parseInteger(value: string | null): number | undefined {
  if (!value) {
    return;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNullableDate(value: unknown): Date | null | undefined {
  if (value === undefined) {
    return;
  }
  if (value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw AthenaAuthRuntimeError.badRequest(
      "banExpires must be an ISO date or null"
    );
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AthenaAuthRuntimeError.badRequest(
      "banExpires must be a valid ISO date"
    );
  }
  return parsed;
}

export async function handleAdminRoute(
  request: Request,
  path: string,
  method: string,
  ctx: AdminRouteContext
): Promise<Response | undefined> {
  if (!path.startsWith("/admin/")) {
    return;
  }

  // Exiting impersonation is deliberately authorized by the session marker,
  // not by the impersonated user's role. Otherwise an admin impersonating a
  // normal user could not escape the impersonated session.
  if (path === ATHENA_AUTH_ADMIN_PATHS.stopImpersonating && method === "POST") {
    const current = await ctx.requireSession(request);
    if (!current.session.impersonated_by) {
      throw AthenaAuthRuntimeError.badRequest(
        "Current session is not impersonated"
      );
    }
    const adminId = current.session.impersonated_by;
    const adminUser = await ctx.store.getUser(adminId);
    if (!adminUser) {
      throw AthenaAuthRuntimeError.notFound(
        "Impersonating administrator not found"
      );
    }
    const restored = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: current.session.id,
          userId: adminId,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.impersonation.end",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        const restored = restoredAuthenticationFromImpersonation(
          current.session
        );
        await scope.admin.deleteSession(current.token);
        return ctx.issueSession(request, scope.stores, adminId, restored);
      },
      input: { sessionId: current.session.id },
      previous: async () => ({
        session: sanitizeHookSession(current.session),
      }),
      resultOf: () => ({
        id: current.session.id,
        revoked: true as const,
        userId: current.session.user_id,
      }),
      secondaryEvents: (issued) => [
        {
          event: "session.issue" as const,
          input: { userId: adminId },
          result: { session: sanitizeHookSession(issued) },
        },
      ],
    });
    return jsonResponse(
      200,
      {
        impersonatedBy: adminId,
        session: toPublicSession(restored),
        success: true,
        user: toPublicUser(adminUser),
      },
      ctx.headers
    );
  }

  const actor = await requireAdmin(request, ctx);

  if (path === ATHENA_AUTH_ADMIN_PATHS.listUsers && method === "GET") {
    const url = new URL(request.url);
    const page = await ctx.store.listUsers({
      banned: parseBoolean(url.searchParams.get("banned")),
      limit: parseInteger(url.searchParams.get("limit")),
      offset: parseInteger(url.searchParams.get("offset")),
      query: url.searchParams.get("query") ?? undefined,
      role: url.searchParams.get("role") ?? undefined,
    });
    return jsonResponse(
      200,
      {
        limit: page.limit,
        offset: page.offset,
        total: page.total,
        users: page.users.map((user) => toPublicUser(user)),
      },
      ctx.headers
    );
  }

  if (
    path === ATHENA_AUTH_ADMIN_PATHS.getUser &&
    (method === "GET" || method === "POST")
  ) {
    const userId =
      method === "GET"
        ? new URL(request.url).searchParams.get("userId")?.trim()
        : asStringField(
            await readJsonBody(request, ctx.config.security.bodyLimitBytes),
            "userId"
          );
    if (!userId) {
      throw AthenaAuthRuntimeError.badRequest("userId is required");
    }
    const user = await ctx.store.getUser(userId);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.createUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const email = requireStringField(body, "email");
    if (!isValidEmail(email)) {
      throw AthenaAuthRuntimeError.badRequest(
        "email must be a valid email address"
      );
    }
    if (await ctx.store.getUserByEmail(email)) {
      throw AthenaAuthRuntimeError.conflict(
        "A user with this email already exists"
      );
    }
    const password = requireStringField(body, "password");
    validatePassword(password, {
      maxLength: ctx.config.emailAndPassword.maxPasswordLength,
      minLength: ctx.config.emailAndPassword.minPasswordLength,
    });
    const requestedRole =
      normalizeAdminRole(asStringField(body, "role")) ?? "user";
    if (!canAssignRole(actor.user.role, requestedRole)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Cannot assign a role at or above your authority"
      );
    }
    const hash = await ctx.hasher.hash(password);
    const user = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.create",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        return scope.admin.createUser({
          email,
          emailVerified: body.emailVerified === true,
          id: crypto.randomUUID(),
          metadata: withPasswordHash({}, hash),
          name: asStringField(body, "name") ?? email.split("@")[0] ?? email,
          password,
          role: requestedRole,
          username: asStringField(body, "username"),
        }, actor.user.id);
      },
      input: {
        email,
        name: asStringField(body, "name") ?? email.split("@")[0] ?? email,
        username: asStringField(body, "username"),
      },
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.updateUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    const previous = await ctx.store.getUser(userId);
    const user = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.update",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        return scope.admin.updateUser({
          email: asStringField(body, "email"),
          emailVerified:
            typeof body.emailVerified === "boolean"
              ? body.emailVerified
              : undefined,
          image: body.image === null ? null : asStringField(body, "image"),
          name: body.name === null ? null : asStringField(body, "name"),
          userId,
        });
      },
      input: {
        image: body.image === null ? null : asStringField(body, "image"),
        name: body.name === null ? null : asStringField(body, "name"),
        userId,
      },
      previous: async () => {
        if (!previous) {
          throw AthenaAuthRuntimeError.notFound("User not found");
        }
        return { user: sanitizeHookUser(previous) };
      },
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.setRole && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    const role = normalizeAdminRole(requireStringField(body, "role"));
    if (!role) {
      throw AthenaAuthRuntimeError.badRequest("role is required");
    }
    if (
      userId === actor.user.id &&
      role !== normalizeAdminRole(actor.user.role)
    ) {
      throw AthenaAuthRuntimeError.badRequest(
        "Administrators cannot change their own role"
      );
    }
    const target = await ctx.store.getUser(userId);
    if (!target) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    if (!canAssignRole(actor.user.role, role)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Cannot assign a role at or above your authority"
      );
    }
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Cannot change the role of an equal or higher administrator"
      );
    }
    const user = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.role.update",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        return scope.admin.updateUser({ role, userId }, actor.user.id);
      },
      input: { role, userId },
      previous: async () => ({ role: target.role }),
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.banUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest(
        "Administrators cannot ban themselves"
      );
    }
    const target = await ctx.store.getUser(userId);
    if (!target) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Cannot ban an equal or higher administrator"
      );
    }
    let banExpires = parseNullableDate(body.banExpires);
    if (banExpires === undefined && body.banExpiresIn !== undefined) {
      const seconds = Number(body.banExpiresIn);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw AthenaAuthRuntimeError.badRequest(
          "banExpiresIn must be a positive number of seconds"
        );
      }
      banExpires = new Date(Date.now() + seconds * 1000);
    }
    const user = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.ban",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        const banned = await scope.admin.updateUser({
          banExpires,
          banned: true,
          banReason:
            body.banReason === null ? null : asStringField(body, "banReason"),
          userId,
        });
        await ctx.revokeBridgeCodesForUser?.(userId);
        const revokedSessions = await scope.admin.deleteUserSessions(userId);
        return { banned, revokedSessions };
      },
      input: { userId },
      previous: async () => ({ banned: Boolean(target.banned) }),
      resultOf: ({ banned }) => ({ user: sanitizeHookUser(banned) }),
    });
    return jsonResponse(
      200,
      {
        revokedSessions: user.revokedSessions,
        user: toPublicUser(user.banned),
      },
      ctx.headers
    );
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.unbanUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    const previous = await ctx.store.getUser(userId);
    if (!previous) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    const user = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.unban",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        return scope.admin.updateUser({
          banExpires: null,
          banned: false,
          banReason: null,
          userId,
        });
      },
      input: { userId },
      previous: async () => ({ banned: Boolean(previous.banned) }),
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (
    path === ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions &&
    method === "POST"
  ) {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    const exceptCurrent =
      body.exceptCurrent === true && userId === actor.user.id;
    const exceptToken = exceptCurrent ? actor.token : undefined;
    const revokeScope = exceptCurrent ? "others" : "all";
    const actorSession = sanitizeHookSession(actor.session);
    const outcome = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.revoke",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        const live = (await scope.stores.listUserSessions(userId)).filter(
          (session) => !exceptCurrent || session.token !== actor.token
        );
        await ctx.revokeBridgeCodesForUser?.(userId, exceptToken);
        const revoked = await scope.admin.deleteUserSessions(
          userId,
          exceptToken
        );
        return {
          partitioned: splitPrimaryAndRest(
            live.map((session) => sanitizeHookSession(session))
          ),
          revoked,
        };
      },
      input: {
        scope: revokeScope,
        userId,
      },
      previous: async () => ({ session: actorSession }),
      previousOf: (outcome) =>
        outcome.partitioned
          ? { session: outcome.partitioned.primary }
          : { session: actorSession },
      resultOf: (outcome) =>
        toAuthSessionRevokeReceipt(
          outcome.partitioned?.primary ?? actorSession
        ),
      secondaryEvents: (outcome) =>
        (outcome.partitioned?.rest ?? []).map(
          (session: { id: string; userId: string }) => ({
            event: "session.revoke" as const,
            input: { scope: revokeScope, userId },
            previous: { session },
            result: toAuthSessionRevokeReceipt(session),
          })
        ),
      shouldPersistAudit: (outcome) => outcome.partitioned !== undefined,
    });
    return jsonResponse(
      200,
      { revoked: outcome.revoked, success: true },
      ctx.headers
    );
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.removeUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest(
        "Administrators cannot remove themselves"
      );
    }
    const target = await ctx.store.getUser(userId);
    if (!target) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Cannot remove an equal or higher administrator"
      );
    }
    const removed = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.delete",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        await ctx.revokeBridgeCodesForUser?.(userId);
        return scope.admin.deleteUser(userId);
      },
      input: { userId },
      previous: async () => ({ user: sanitizeHookUser(target) }),
      resultOf: () => ({
        deleted: true as const,
        id: userId,
        userId,
      }),
    });
    if (!removed) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    return jsonResponse(200, { success: true }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.impersonateUser && method === "POST") {
    const body = await readJsonBody(
      request,
      ctx.config.security.bodyLimitBytes
    );
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest(
        "Cannot impersonate the current user"
      );
    }
    const target = await ctx.store.getUser(userId);
    if (!target) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden(
        "Only a higher administrator may impersonate this user"
      );
    }
    const requestedExpiry = Number(body.expiresInSeconds ?? 15 * 60);
    const expiresInSeconds = Number.isFinite(requestedExpiry)
      ? Math.min(60 * 60, Math.max(60, requestedExpiry))
      : 15 * 60;
    const session = await ctx.mutate({
      context: {
        actor: {
          kind: "admin",
          sessionId: actor.session.id,
          userId: actor.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.impersonation.start",
      execute: async (scope) => {
        if (!scope.admin) {
          throw AthenaAuthRuntimeError.internal(
            new Error("Admin store is required")
          );
        }
        const authentication = impersonationAuthenticationFromActor(
          actor.session
        );
        return scope.admin.createImpersonationSession({
          activeOrganizationId: actor.session.active_organization_id,
          authenticatedAt: authentication.authenticatedAt,
          authenticationMethods: authentication.methods,
          expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
          id: crypto.randomUUID(),
          impersonatedBy: actor.user.id,
          ipAddress: requestClientIp(request, ctx.config.security.trustedProxy),
          token: `session_${crypto.randomUUID()}`,
          userAgent: request.headers.get("user-agent"),
          userId,
        });
      },
      input: { userId },
      resultOf: (row) => ({ session: sanitizeHookSession(row) }),
    });
    ctx.headers.append(
      "set-cookie",
      createSessionCookieHeader(session.token, {
        cookieName: ctx.config.session.cookieName,
        expiresAt: new Date(session.expires_at),
        secure: shouldSetSecureCookie(
          request,
          ctx.config.security.cookieSecure
        ),
      })
    );
    return jsonResponse(
      200,
      {
        session: toPublicSession(session),
        user: toPublicUser(target),
      },
      ctx.headers
    );
  }

  throw AthenaAuthRuntimeError.notFound("Admin route not found");
}
