import type { NormalizedAthenaAuthConfig } from "../config.ts";
import {
  createSessionCookieHeader,
  shouldSetSecureCookie,
} from "./cookies.ts";
import {
  ATHENA_AUTH_ADMIN_PATHS,
  canActOnAdminTarget,
  canAssignRole,
  isAthenaAdminRole,
  normalizeAdminRole,
  type AthenaAuthAdminStore,
} from "./admin-contract.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { toPublicSession, toPublicUser } from "./models.ts";
import type { AthenaAuthPasswordHasher } from "./password.ts";
import { validatePassword, withPasswordHash } from "./password.ts";
import {
  asStringField,
  readJsonBody,
  requireStringField,
  requestClientIp,
} from "./security.ts";

export interface AdminRouteContext {
  config: NormalizedAthenaAuthConfig;
  hasher: AthenaAuthPasswordHasher;
  headers: Headers;
  issueSession: (request: Request, userId: string) => Promise<AuthSessionRow>;
  requireSession: (request: Request) => Promise<{
    session: AuthSessionRow;
    token: string;
    user: AuthUserRow;
  }>;
  store: AthenaAuthAdminStore;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function requireAdmin(
  request: Request,
  ctx: AdminRouteContext
): Promise<{ session: AuthSessionRow; token: string; user: AuthUserRow }> {
  const resolved = await ctx.requireSession(request);
  if (!isAthenaAdminRole(resolved.user.role)) {
    throw AthenaAuthRuntimeError.forbidden("Administrator access required");
  }
  return resolved;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
}

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseNullableDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") {
    throw AthenaAuthRuntimeError.badRequest("banExpires must be an ISO date or null");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw AthenaAuthRuntimeError.badRequest("banExpires must be a valid ISO date");
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
    return undefined;
  }

  // Exiting impersonation is deliberately authorized by the session marker,
  // not by the impersonated user's role. Otherwise an admin impersonating a
  // normal user could not escape the impersonated session.
  if (path === ATHENA_AUTH_ADMIN_PATHS.stopImpersonating && method === "POST") {
    const current = await ctx.requireSession(request);
    if (!current.session.impersonated_by) {
      throw AthenaAuthRuntimeError.badRequest("Current session is not impersonated");
    }
    const adminId = current.session.impersonated_by;
    await ctx.store.deleteSession(current.token);
    const adminUser = await ctx.store.getUser(adminId);
    if (!adminUser) {
      throw AthenaAuthRuntimeError.notFound("Impersonating administrator not found");
    }
    const restored = await ctx.issueSession(request, adminId);
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
    return jsonResponse(200, {
      limit: page.limit,
      offset: page.offset,
      total: page.total,
      users: page.users.map((user) => toPublicUser(user)),
    }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.getUser && (method === "GET" || method === "POST")) {
    const userId = method === "GET"
      ? new URL(request.url).searchParams.get("userId")?.trim()
      : asStringField(await readJsonBody(request, ctx.config.security.bodyLimitBytes), "userId");
    if (!userId) throw AthenaAuthRuntimeError.badRequest("userId is required");
    const user = await ctx.store.getUser(userId);
    if (!user) throw AthenaAuthRuntimeError.notFound("User not found");
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.createUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const email = requireStringField(body, "email");
    if (!isValidEmail(email)) {
      throw AthenaAuthRuntimeError.badRequest("email must be a valid email address");
    }
    if (await ctx.store.getUserByEmail(email)) {
      throw AthenaAuthRuntimeError.conflict("A user with this email already exists");
    }
    const password = requireStringField(body, "password");
    validatePassword(password, {
      maxLength: ctx.config.emailAndPassword.maxPasswordLength,
      minLength: ctx.config.emailAndPassword.minPasswordLength,
    });
    const requestedRole = normalizeAdminRole(asStringField(body, "role")) ?? "user";
    if (!canAssignRole(actor.user.role, requestedRole)) {
      throw AthenaAuthRuntimeError.forbidden("Cannot assign a role at or above your authority");
    }
    const hash = await ctx.hasher.hash(password);
    const user = await ctx.store.createUser({
      email,
      emailVerified: body.emailVerified === true,
      id: crypto.randomUUID(),
      metadata: withPasswordHash({}, hash),
      name: asStringField(body, "name") ?? email.split("@")[0] ?? email,
      password,
      role: requestedRole,
      username: asStringField(body, "username"),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.updateUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const user = await ctx.store.updateUser({
      email: asStringField(body, "email"),
      emailVerified: typeof body.emailVerified === "boolean" ? body.emailVerified : undefined,
      image: body.image === null ? null : asStringField(body, "image"),
      name: body.name === null ? null : asStringField(body, "name"),
      userId: requireStringField(body, "userId"),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.setRole && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const userId = requireStringField(body, "userId");
    const role = normalizeAdminRole(requireStringField(body, "role"));
    if (!role) {
      throw AthenaAuthRuntimeError.badRequest("role is required");
    }
    if (userId === actor.user.id && role !== normalizeAdminRole(actor.user.role)) {
      throw AthenaAuthRuntimeError.badRequest("Administrators cannot change their own role");
    }
    const target = await ctx.store.getUser(userId);
    if (!target) throw AthenaAuthRuntimeError.notFound("User not found");
    if (!canAssignRole(actor.user.role, role)) {
      throw AthenaAuthRuntimeError.forbidden("Cannot assign a role at or above your authority");
    }
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden("Cannot change the role of an equal or higher administrator");
    }
    const user = await ctx.store.updateUser({ role, userId });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.banUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest("Administrators cannot ban themselves");
    }
    const target = await ctx.store.getUser(userId);
    if (!target) throw AthenaAuthRuntimeError.notFound("User not found");
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden("Cannot ban an equal or higher administrator");
    }
    let banExpires = parseNullableDate(body.banExpires);
    if (banExpires === undefined && body.banExpiresIn !== undefined) {
      const seconds = Number(body.banExpiresIn);
      if (!Number.isFinite(seconds) || seconds <= 0) {
        throw AthenaAuthRuntimeError.badRequest("banExpiresIn must be a positive number of seconds");
      }
      banExpires = new Date(Date.now() + seconds * 1000);
    }
    const user = await ctx.store.updateUser({
      banExpires,
      banned: true,
      banReason: body.banReason === null ? null : asStringField(body, "banReason"),
      userId,
    });
    const revokedSessions = await ctx.store.deleteUserSessions(userId);
    return jsonResponse(200, { revokedSessions, user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.unbanUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const user = await ctx.store.updateUser({
      banExpires: null,
      banned: false,
      banReason: null,
      userId: requireStringField(body, "userId"),
    });
    return jsonResponse(200, { user: toPublicUser(user) }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.revokeUserSessions && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const userId = requireStringField(body, "userId");
    const exceptCurrent = body.exceptCurrent === true && userId === actor.user.id;
    const revoked = await ctx.store.deleteUserSessions(userId, exceptCurrent ? actor.token : undefined);
    return jsonResponse(200, { revoked, success: true }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.removeUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest("Administrators cannot remove themselves");
    }
    const target = await ctx.store.getUser(userId);
    if (!target) throw AthenaAuthRuntimeError.notFound("User not found");
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden("Cannot remove an equal or higher administrator");
    }
    const removed = await ctx.store.deleteUser(userId);
    if (!removed) throw AthenaAuthRuntimeError.notFound("User not found");
    return jsonResponse(200, { success: true }, ctx.headers);
  }

  if (path === ATHENA_AUTH_ADMIN_PATHS.impersonateUser && method === "POST") {
    const body = await readJsonBody(request, ctx.config.security.bodyLimitBytes);
    const userId = requireStringField(body, "userId");
    if (userId === actor.user.id) {
      throw AthenaAuthRuntimeError.badRequest("Cannot impersonate the current user");
    }
    const target = await ctx.store.getUser(userId);
    if (!target) throw AthenaAuthRuntimeError.notFound("User not found");
    if (!canActOnAdminTarget(actor.user.role, target.role)) {
      throw AthenaAuthRuntimeError.forbidden("Only a higher administrator may impersonate this user");
    }
    const requestedExpiry = Number(body.expiresInSeconds ?? 15 * 60);
    const expiresInSeconds = Number.isFinite(requestedExpiry)
      ? Math.min(60 * 60, Math.max(60, requestedExpiry))
      : 15 * 60;
    const session = await ctx.store.createImpersonationSession({
      activeOrganizationId: actor.session.active_organization_id,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      id: crypto.randomUUID(),
      impersonatedBy: actor.user.id,
      ipAddress: requestClientIp(request, ctx.config.security.trustedProxy),
      token: `session_${crypto.randomUUID()}`,
      userAgent: request.headers.get("user-agent"),
      userId,
    });
    ctx.headers.append(
      "set-cookie",
      createSessionCookieHeader(session.token, {
        cookieName: ctx.config.session.cookieName,
        expiresAt: new Date(session.expires_at),
        secure: shouldSetSecureCookie(request, ctx.config.security.cookieSecure),
      })
    );
    return jsonResponse(200, {
      session: toPublicSession(session),
      user: toPublicUser(target),
    }, ctx.headers);
  }

  throw AthenaAuthRuntimeError.notFound("Admin route not found");
}
