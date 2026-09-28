import type { AthenaRightKey } from "../../rights/key.ts";
import { rightMatches } from "../../rights/matching.ts";
import type { AuthBridgeCodeStore } from "../bridge/store.ts";
import type { NormalizedAthenaAuthConfig } from "../config.ts";
import { authEmailEvents } from "../email/index.ts";
import type { AuthDomainMutate } from "../hooks/execute.ts";
import {
  sanitizeHookApiKey,
  sanitizeHookSession,
  sanitizeHookUser,
} from "../hooks/sanitize.ts";
import {
  type ApiKeyScopeKind,
  apiKeyScopeKind,
  bindApiKeyAuthorization,
  generateApiKey,
  isApiKeyScopeUsable,
  isApiKeyUsable,
  normalizeApiKeyPrefix,
  parseApiKeyLifetime,
  parseApiKeyPermissionKeys,
  parseApiKeyRemaining,
  sha256Base64Url,
  toPublicApiKey,
} from "./api-key.ts";
import { buildSnapshot } from "./authorization-routes.ts";
import { revokeAuthBridgeCodesForSessions } from "./bridge/revoke.ts";
import {
  createClearSessionCookieHeader,
  readBearerToken,
  shouldSetSecureCookie,
} from "./cookies.ts";
import {
  applyChangeEmailToken,
  type MailerEmit,
  resolveChangeEmailTarget,
  tokenizedUrl,
} from "./email/user-routes.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import type { AuthSessionRow, AuthUserRow } from "./models.ts";
import { toPublicUser } from "./models.ts";
import type { AthenaAuthPasswordHasher } from "./password.ts";
import { extractPasswordHash } from "./password.ts";
import {
  asStringField,
  type OtpRateLimiter,
  readJsonBody,
  requireStringField,
} from "./security.ts";
import type { AuthApiKeyRow } from "./stores.ts";
import {
  buildTotpUri,
  decodeBase32,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.ts";

export interface ExtendedRouteContext {
  config: NormalizedAthenaAuthConfig;
  emitMail?: MailerEmit;
  getBridgeCodeStore?: () => AuthBridgeCodeStore;
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
    headers: Headers,
    authentication: import("./authentication-context.ts").IssueSessionAuthentication
  ) => Promise<AuthSessionRow>;
  mutate: AuthDomainMutate;
  otpRateLimiter: OtpRateLimiter;
  otpVerificationRateLimiter: OtpRateLimiter;
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ session: AuthSessionRow; token: string; user: AuthUserRow }>;
  stores: AthenaAuthStores;
  traceId: string;
}

async function requirePassword(
  user: AuthUserRow,
  password: string,
  hasher: AthenaAuthPasswordHasher
): Promise<void> {
  const storedHash = extractPasswordHash(user.metadata);
  if (!(storedHash && (await hasher.verify(password, storedHash)))) {
    throw AthenaAuthRuntimeError.invalidCredentials();
  }
}

function generateBackupCodes(): string[] {
  return Array.from({ length: 10 }, () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(5)))
      .toString("hex")
      .slice(0, 8)
      .toUpperCase()
  );
}

async function hashBackupCodes(
  codes: string[],
  hasher: AthenaAuthPasswordHasher
): Promise<string> {
  const hashed = [];
  for (const code of codes) {
    hashed.push(await hasher.hash(code));
  }
  return JSON.stringify(hashed);
}

export async function handleExtendedRoute(
  request: Request,
  path: string,
  method: string,
  ctx: ExtendedRouteContext
): Promise<Response | undefined> {
  const { config, hasher, headers, stores } = ctx;

  if (path === "/send-verification-email" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const email = requireStringField(body, "email");
    const user = await stores.getUserByEmail(email);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound(
        "No user found with this email address"
      );
    }
    if (user.email_verified) {
      throw AthenaAuthRuntimeError.badRequest("Email is already verified");
    }
    const token = `verify_${crypto.randomUUID()}`;
    await stores.createVerification({
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier: email,
      value: token,
    });
    const callbackURL = asStringField(body, "callbackURL");
    const origin = new URL(request.url).origin;
    const verificationUrl = tokenizedUrl(
      callbackURL,
      token,
      origin,
      `${config.basePath || ""}/verify-email`,
      config.security.trustedOrigins
    );
    await ctx.emitMail?.({
      data: {
        legacy_hook_url: callbackURL ? verificationUrl : token,
        verification_url: verificationUrl,
      },
      eventType: authEmailEvents.user.email.verify,
      recipient: email,
    });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/verify-email" && method === "GET") {
    const token = new URL(request.url).searchParams.get("token")?.trim();
    if (!token) {
      throw AthenaAuthRuntimeError.badRequest("token is required");
    }
    const verification = await stores.getVerificationByValue(token);
    if (!verification) {
      throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
    }
    const user = await stores.getUserByEmail(verification.identifier);
    if (!user) {
      throw AthenaAuthRuntimeError.notFound("User not found");
    }
    const updated = await ctx.mutate({
      context: {
        actor: { kind: "user", userId: user.id },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.email.verify",
      execute: async (scope) => {
        const consumed = await scope.stores.consumeVerification(token);
        if (!consumed) {
          throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
        }
        return scope.stores.updateUser(user.id, { emailVerified: true });
      },
      input: { userId: user.id },
      previous: async () => ({ emailVerified: Boolean(user.email_verified) }),
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(
      200,
      { status: true, user: toPublicUser(updated) },
      headers
    );
  }

  if (path === "/change-email" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const newEmail = requireStringField(body, "newEmail");
    if (await stores.getUserByEmail(newEmail)) {
      throw AthenaAuthRuntimeError.conflict(
        "A user with this email already exists"
      );
    }
    const token = `change_${crypto.randomUUID()}`;
    await stores.createVerification({
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier: `change-email:${resolved.user.id}:${newEmail}`,
      value: token,
    });
    const origin = new URL(request.url).origin;
    const verificationUrl = tokenizedUrl(
      asStringField(body, "callbackURL"),
      token,
      origin,
      `${config.basePath || ""}/change-email/verify`,
      config.security.trustedOrigins
    );
    await ctx.emitMail?.({
      data: {
        legacy_hook_url: asStringField(body, "callbackURL")
          ? verificationUrl
          : token,
        verification_url: verificationUrl,
      },
      eventType: authEmailEvents.user.email.changeConfirmation,
      recipient: newEmail,
    });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/change-email/verify" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const token = requireStringField(body, "token");
    const target = await resolveChangeEmailTarget(stores, token);
    const previousUser = await stores.getUserById(target.userId);
    const updated = await ctx.mutate({
      context: {
        actor: { kind: "user", userId: target.userId },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.email.update",
      execute: (scope) => applyChangeEmailToken(scope.stores, token),
      input: { email: target.email, userId: target.userId },
      previous: async () => {
        if (!previousUser) {
          throw AthenaAuthRuntimeError.notFound("User not found");
        }
        return { email: previousUser.email };
      },
      resultOf: (row) => ({ user: sanitizeHookUser(row) }),
    });
    return jsonResponse(
      200,
      { status: true, user: toPublicUser(updated) },
      headers
    );
  }

  if (path === "/delete-user" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const password = asStringField(body, "password");
    if (password) {
      await requirePassword(resolved.user, password, hasher);
    } else if (resolved.user.email) {
      const token = `delete_${crypto.randomUUID()}`;
      await stores.createVerification({
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        id: crypto.randomUUID(),
        identifier: `delete_user:${resolved.user.id}`,
        value: token,
      });
      const origin = new URL(request.url).origin;
      const verificationUrl = tokenizedUrl(
        asStringField(body, "callbackURL"),
        token,
        origin,
        `${config.basePath || ""}/delete-user/verify`,
        config.security.trustedOrigins
      );
      await ctx.emitMail?.({
        data: { verification_url: verificationUrl },
        eventType: authEmailEvents.user.account.deletionConfirmation,
        recipient: resolved.user.email,
      });
      return jsonResponse(200, { status: true }, headers);
    }
    await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "user.delete",
      execute: async (scope) => {
        const sessions = await scope.stores.listUserSessions(resolved.user.id);
        const bridgeStore = ctx.getBridgeCodeStore?.();
        if (bridgeStore) {
          await revokeAuthBridgeCodesForSessions(
            bridgeStore,
            sessions.map((session) => session.id)
          );
        }
        await scope.stores.deleteUser(resolved.user.id);
      },
      input: { userId: resolved.user.id },
      previous: async () => ({ user: sanitizeHookUser(resolved.user) }),
      resultOf: () => ({
        deleted: true as const,
        id: resolved.user.id,
        userId: resolved.user.id,
      }),
    });
    headers.append(
      "set-cookie",
      createClearSessionCookieHeader(
        config.session.cookieName,
        shouldSetSecureCookie(request, config.security.cookieSecure)
      )
    );
    return jsonResponse(
      200,
      { message: "User deleted", success: true },
      headers
    );
  }

  if (path === "/api-key/create" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const permissions = asStringField(body, "permissions");
    const activeOrganizationId =
      resolved.session.active_organization_id ?? null;
    const scopeKind = activeOrganizationId ? "organization" : "platform";
    if (permissions) {
      await validateApiKeyPermissions(
        stores,
        resolved.user,
        permissions,
        activeOrganizationId,
        scopeKind
      );
    }
    let prefix: string | undefined;
    let expiresIn: number | undefined;
    let remaining: number | undefined;
    try {
      prefix = normalizeApiKeyPrefix(body.prefix);
      expiresIn = parseApiKeyLifetime(body.expiresIn);
      remaining = parseApiKeyRemaining(body.remaining);
    } catch (error) {
      throw AthenaAuthRuntimeError.badRequest(
        error instanceof Error ? error.message : "Invalid API key options"
      );
    }
    const generated = await generateApiKey(prefix);
    const expiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000)
      : null;
    const created = nowIso();
    const row: AuthApiKeyRow = {
      created_at: created,
      enabled: true,
      expires_at: expiresAt,
      id: crypto.randomUUID(),
      key: generated.hash,
      last_request: null,
      metadata: asStringField(body, "metadata") ?? null,
      name: asStringField(body, "name") ?? null,
      organization_id: activeOrganizationId,
      permissions: permissions ?? null,
      prefix: prefix ?? null,
      remaining: remaining ?? null,
      scope_kind: scopeKind,
      start: generated.start,
      updated_at: created,
      user_id: resolved.user.id,
    };
    const stored = await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "apiKey.create",
      execute: (scope) => scope.stores.createApiKey(row),
      input: {
        name: asStringField(body, "name") ?? undefined,
        userId: row.user_id,
      },
      resultOf: (created) => ({ apiKey: sanitizeHookApiKey(created) }),
    });
    return jsonResponse(
      200,
      toPublicApiKey(stored, generated.fullKey),
      headers
    );
  }

  if (path === "/api-key/list" && method === "GET") {
    const resolved = await ctx.requireSession(request, stores);
    const keys = await stores.listApiKeys(resolved.user.id);
    return jsonResponse(
      200,
      {
        apiKeys: keys.map((key) => {
          const publicKey = toPublicApiKey(key);
          publicKey.key = undefined;
          return publicKey;
        }),
      },
      headers
    );
  }

  if (path === "/api-key/get" && (method === "GET" || method === "POST")) {
    const resolved = await ctx.requireSession(request, stores);
    const id =
      method === "GET"
        ? new URL(request.url).searchParams.get("id")
        : asStringField(
            await readJsonBody(request, config.security.bodyLimitBytes),
            "id"
          );
    if (!id) {
      throw AthenaAuthRuntimeError.badRequest("id is required");
    }
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const publicKey = toPublicApiKey(key);
    publicKey.key = undefined;
    return jsonResponse(200, publicKey, headers);
  }

  if (path === "/api-key/delete" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const id = asStringField(body, "keyId") ?? requireStringField(body, "id");
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "apiKey.delete",
      execute: async (scope) => {
        await scope.stores.deleteApiKey(id);
      },
      input: { id },
      previous: async () => ({ apiKey: sanitizeHookApiKey(key) }),
      resultOf: () => ({
        deleted: true as const,
        id,
        userId: key.user_id,
      }),
    });
    return jsonResponse(200, { success: true }, headers);
  }

  if (path === "/api-key/verify" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const rawKey = requireStringField(body, "key");
    const hash = await sha256Base64Url(rawKey);
    const key = await stores.getApiKeyByHash(hash);
    if (
      !(key && isApiKeyUsable(key) && (await isApiKeyScopeUsable(key, stores)))
    ) {
      return jsonResponse(
        200,
        {
          error: { code: "INVALID_API_KEY", message: "Invalid API key" },
          key: null,
          valid: false,
        },
        headers
      );
    }
    const user = await stores.getUserById(key.user_id);
    let declared: AthenaRightKey[] | undefined;
    try {
      declared = key.permissions
        ? parseApiKeyPermissionKeys(key.permissions)
        : undefined;
    } catch {
      declared = undefined;
    }
    const scopeKind = apiKeyScopeKind(key);
    const ownerAuthorization = user
      ? await buildSnapshot(stores, {
          session: {
            active_organization_id:
              scopeKind === "organization"
                ? (key.organization_id ?? null)
                : null,
          },
          user,
        })
      : undefined;
    const authorization = ownerAuthorization
      ? bindApiKeyAuthorization(ownerAuthorization, declared, scopeKind)
      : undefined;
    const requestedPermissions = body.permissions;
    if (requestedPermissions !== undefined) {
      let requestedPermissionJson: string;
      if (typeof requestedPermissions === "string") {
        requestedPermissionJson = requestedPermissions;
      } else if (
        requestedPermissions &&
        typeof requestedPermissions === "object" &&
        !Array.isArray(requestedPermissions)
      ) {
        requestedPermissionJson = JSON.stringify(requestedPermissions);
      } else {
        requestedPermissionJson = "";
      }
      try {
        const requested = parseApiKeyPermissionKeys(requestedPermissionJson);
        if (
          !authorization ||
          requested.some(
            (right) =>
              !authorization.effectiveRights.some((granted) =>
                rightMatches(granted, right)
              )
          )
        ) {
          throw new Error("invalid");
        }
      } catch {
        return jsonResponse(
          200,
          {
            error: { code: "INVALID_API_KEY", message: "Invalid API key" },
            key: null,
            valid: false,
          },
          headers
        );
      }
    }
    if (!(user && authorization)) {
      return jsonResponse(
        200,
        {
          error: { code: "INVALID_API_KEY", message: "Invalid API key" },
          key: null,
          valid: false,
        },
        headers
      );
    }
    const consumed = await stores.consumeApiKey(key.id);
    if (!consumed) {
      return jsonResponse(
        200,
        {
          error: { code: "INVALID_API_KEY", message: "Invalid API key" },
          key: null,
          valid: false,
        },
        headers
      );
    }
    const publicKey = toPublicApiKey(consumed);
    publicKey.key = undefined;
    return jsonResponse(
      200,
      { error: null, key: publicKey, valid: true },
      headers
    );
  }

  if (path === "/api-key/delete-all-expired-api-keys" && method === "POST") {
    await ctx.requireSession(request, stores);
    const deleted = await stores.deleteExpiredApiKeys();
    return jsonResponse(200, { deleted }, headers);
  }

  if (path === "/api-key/update" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const id = asStringField(body, "keyId") ?? requireStringField(body, "id");
    const key = await stores.getApiKeyById(id);
    if (!key || key.user_id !== resolved.user.id) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const enabledRaw = body.enabled;
    const permissions = asStringField(body, "permissions");
    if (permissions !== undefined) {
      const scopeKind = apiKeyScopeKind(key);
      await validateApiKeyPermissions(
        stores,
        resolved.user,
        permissions,
        scopeKind === "organization" ? (key.organization_id ?? null) : null,
        scopeKind
      );
    }
    const updated = await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "apiKey.update",
      execute: async (scope) => {
        const next = await scope.stores.updateApiKey(id, {
          enabled: typeof enabledRaw === "boolean" ? enabledRaw : undefined,
          metadata: asStringField(body, "metadata"),
          name: asStringField(body, "name"),
          permissions,
        });
        if (!next) {
          throw AthenaAuthRuntimeError.notFound("API key not found");
        }
        return next;
      },
      input: { id, name: asStringField(body, "name") },
      previous: async () => ({ name: key.name }),
      resultOf: (row) => ({ apiKey: sanitizeHookApiKey(row) }),
    });
    if (!updated) {
      throw AthenaAuthRuntimeError.notFound("API key not found");
    }
    const publicKey = toPublicApiKey(updated);
    publicKey.key = undefined;
    return jsonResponse(200, publicKey, headers);
  }

  if (path === "/two-factor/enable" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(
      resolved.user,
      requireStringField(body, "password"),
      hasher
    );
    const secret = generateTotpSecret();
    const backupCodes = generateBackupCodes();
    await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "twoFactor.enable",
      execute: async (scope) => {
        await scope.stores.createTwoFactor({
          backupCodes: await hashBackupCodes(backupCodes, hasher),
          id: crypto.randomUUID(),
          secret: secret.encoded,
          userId: resolved.user.id,
        });
        await scope.stores.updateUser(resolved.user.id, {
          twoFactorEnabled: true,
        });
      },
      input: { userId: resolved.user.id },
      resultOf: () => ({ userId: resolved.user.id }),
    });
    return jsonResponse(
      200,
      {
        backupCodes,
        totpURI: buildTotpUri({
          account: resolved.user.email ?? resolved.user.id,
          issuer: asStringField(body, "issuer") ?? "AthenaAuth",
          secret: secret.encoded,
        }),
      },
      headers
    );
  }

  if (path === "/two-factor/get-totp-uri" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(
      resolved.user,
      requireStringField(body, "password"),
      hasher
    );
    const record = await stores.getTwoFactorByUserId(resolved.user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound(
        "Two-factor authentication not enabled"
      );
    }
    return jsonResponse(
      200,
      {
        totpURI: buildTotpUri({
          account: resolved.user.email ?? resolved.user.id,
          secret: record.secret,
        }),
      },
      headers
    );
  }

  if (path === "/two-factor/disable" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(
      resolved.user,
      requireStringField(body, "password"),
      hasher
    );
    await ctx.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: resolved.session.id,
          userId: resolved.user.id,
        },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "twoFactor.disable",
      execute: async (scope) => {
        await scope.stores.deleteTwoFactor(resolved.user.id);
        await scope.stores.updateUser(resolved.user.id, {
          twoFactorEnabled: false,
        });
      },
      input: { userId: resolved.user.id },
      resultOf: () => ({ userId: resolved.user.id }),
    });
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/generate-backup-codes" && method === "POST") {
    const resolved = await ctx.requireSession(request, stores);
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    await requirePassword(
      resolved.user,
      requireStringField(body, "password"),
      hasher
    );
    const record = await stores.getTwoFactorByUserId(resolved.user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound(
        "Two-factor authentication not enabled"
      );
    }
    const backupCodes = generateBackupCodes();
    await stores.updateTwoFactorBackupCodes(
      resolved.user.id,
      await hashBackupCodes(backupCodes, hasher)
    );
    return jsonResponse(200, { backupCodes, status: true }, headers);
  }

  if (path === "/two-factor/verify-totp" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code");
    const pendingToken =
      asStringField(body, "token") ??
      readBearerToken(request.headers.get("authorization"));
    let user: AuthUserRow | undefined;
    if (pendingToken?.startsWith("2fa_")) {
      const verification = await stores.consumeVerification(pendingToken);
      if (!verification) {
        throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
      }
      user = await stores.getUserById(
        verification.identifier.replace(/^2fa_pending:/, "")
      );
    } else {
      user = (await ctx.requireSession(request, stores)).user;
    }
    if (!user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const record = await stores.getTwoFactorByUserId(user.id);
    if (!record) {
      throw AthenaAuthRuntimeError.notFound(
        "Two-factor authentication not enabled"
      );
    }
    if (!(await verifyTotpCode(decodeBase32(record.secret), code))) {
      throw AthenaAuthRuntimeError.badRequest("Invalid TOTP code");
    }
    const session = await ctx.mutate({
      context: {
        actor: { kind: "user", userId: user.id },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.issue",
      execute: (scope) =>
        ctx.issueSession(request, scope.stores, user.id, headers, {
          methods: ["password", "totp"],
        }),
      input: { userId: user.id },
      resultOf: (issued) => ({ session: sanitizeHookSession(issued) }),
    });
    const refreshed = (await stores.getUserById(user.id)) ?? user;
    return jsonResponse(
      200,
      {
        status: true,
        token: session.token,
        user: toPublicUser(refreshed),
      },
      headers
    );
  }

  if (path === "/two-factor/send-otp" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const pendingToken = asStringField(body, "token");
    const pending = pendingToken?.startsWith("2fa_")
      ? await stores.getVerification(pendingToken)
      : undefined;
    const resolved = pending
      ? {
          user: await stores.getUserById(
            pending.identifier.replace(/^2fa_pending:/, "")
          ),
        }
      : await ctx.requireSession(request, stores);
    if (!resolved.user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    if (!(await ctx.otpRateLimiter.consume(`otp:${resolved.user.id}`))) {
      throw AthenaAuthRuntimeError.rateLimited();
    }
    const identifier = `2fa_otp:${resolved.user.id}`;
    const otp = String(
      new DataView(crypto.getRandomValues(new Uint8Array(4)).buffer).getUint32(
        0
      ) % 1_000_000
    ).padStart(6, "0");
    await stores.replaceVerificationByIdentifier({
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      id: crypto.randomUUID(),
      identifier,
      value: otp,
    });
    if (resolved.user.email) {
      await ctx.emitMail?.({
        data: { legacy_hook_url: otp, otp_code: otp },
        eventType: authEmailEvents.user.signIn.otp,
        recipient: resolved.user.email,
      });
    }
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/verify-otp" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code");
    const pendingToken = asStringField(body, "token");
    const pending = pendingToken?.startsWith("2fa_")
      ? await stores.getVerification(pendingToken)
      : undefined;
    const resolved = pending
      ? {
          user: await stores.getUserById(
            pending.identifier.replace(/^2fa_pending:/, "")
          ),
        }
      : await ctx.requireSession(request, stores);
    if (!resolved.user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const user = resolved.user;
    const identifier = `2fa_otp:${user.id}`;
    const attemptKey = `otp-verify:${user.id}`;
    if (!(await ctx.otpVerificationRateLimiter.consume(attemptKey))) {
      await stores.deleteVerificationsByIdentifier(identifier);
      throw AthenaAuthRuntimeError.rateLimited();
    }
    const verification = await stores.consumeVerificationByIdentifierAndValue(
      identifier,
      code
    );
    if (!verification) {
      if (await ctx.otpVerificationRateLimiter.isLimited(attemptKey)) {
        await stores.deleteVerificationsByIdentifier(identifier);
      }
      throw AthenaAuthRuntimeError.badRequest("Invalid OTP code");
    }
    await ctx.otpVerificationRateLimiter.clear(attemptKey);
    if (pending && pendingToken !== undefined) {
      await stores.consumeVerification(pendingToken);
      const session = await ctx.mutate({
        context: {
          actor: { kind: "user", userId: user.id },
          request: ctx.hookRequest(request, path),
          traceId: ctx.traceId,
        },
        event: "session.issue",
        execute: (scope) =>
          ctx.issueSession(request, scope.stores, user.id, headers, {
            methods: ["password", "email_otp"],
          }),
        input: { userId: user.id },
        resultOf: (issued) => ({ session: sanitizeHookSession(issued) }),
      });
      return jsonResponse(
        200,
        { status: true, token: session.token, user: toPublicUser(user) },
        headers
      );
    }
    return jsonResponse(200, { status: true }, headers);
  }

  if (path === "/two-factor/verify-backup-code" && method === "POST") {
    const body = await readJsonBody(request, config.security.bodyLimitBytes);
    const code = requireStringField(body, "code").toUpperCase();
    const pendingToken =
      asStringField(body, "token") ??
      readBearerToken(request.headers.get("authorization"));
    let user: AuthUserRow | undefined;
    if (pendingToken?.startsWith("2fa_")) {
      const verification = await stores.consumeVerification(pendingToken);
      user = verification
        ? await stores.getUserById(
            verification.identifier.replace(/^2fa_pending:/, "")
          )
        : undefined;
    } else {
      user = (await ctx.requireSession(request, stores)).user;
    }
    if (!user) {
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    const record = await stores.getTwoFactorByUserId(user.id);
    if (!record?.backup_codes) {
      throw AthenaAuthRuntimeError.badRequest("Invalid backup code");
    }
    const hashed = JSON.parse(record.backup_codes) as string[];
    let matchedIndex = -1;
    for (const [index, hash] of hashed.entries()) {
      if (await hasher.verify(code, hash)) {
        matchedIndex = index;
        break;
      }
    }
    if (matchedIndex < 0) {
      throw AthenaAuthRuntimeError.badRequest("Invalid backup code");
    }
    hashed.splice(matchedIndex, 1);
    await stores.updateTwoFactorBackupCodes(user.id, JSON.stringify(hashed));
    const session = await ctx.mutate({
      context: {
        actor: { kind: "user", userId: user.id },
        request: ctx.hookRequest(request, path),
        traceId: ctx.traceId,
      },
      event: "session.issue",
      execute: (scope) =>
        ctx.issueSession(request, scope.stores, user.id, headers, {
          methods: ["password", "recovery_code"],
        }),
      input: { userId: user.id },
      resultOf: (issued) => ({ session: sanitizeHookSession(issued) }),
    });
    return jsonResponse(
      200,
      {
        session: {
          token: session.token,
          userId: user.id,
        },
        user: toPublicUser(user),
      },
      headers
    );
  }
}

export async function resolveApiKeyUser(
  request: Request,
  stores: AthenaAuthStores
): Promise<
  | {
      key: AuthApiKeyRow;
      permissions?: AthenaRightKey[];
      user: AuthUserRow;
    }
  | undefined
> {
  const rawKey = request.headers.get("x-api-key")?.trim();
  if (!rawKey) {
    return;
  }
  const hash = await sha256Base64Url(rawKey);
  const key = await stores.getApiKeyByHash(hash);
  if (
    !(key && isApiKeyUsable(key) && (await isApiKeyScopeUsable(key, stores)))
  ) {
    return;
  }
  const consumed = await stores.consumeApiKey(key.id);
  if (!consumed) {
    return;
  }
  let permissions: AthenaRightKey[] | undefined;
  if (consumed.permissions) {
    try {
      permissions = parseApiKeyPermissionKeys(consumed.permissions);
    } catch {
      return;
    }
  }
  const user = await stores.getUserById(consumed.user_id);
  return user ? { key: consumed, permissions, user } : undefined;
}

async function validateApiKeyPermissions(
  stores: AthenaAuthStores,
  user: AuthUserRow,
  permissions: string,
  activeOrganizationId: string | null,
  scopeKind: ApiKeyScopeKind
): Promise<void> {
  let requestedRights: AthenaRightKey[];
  try {
    requestedRights = parseApiKeyPermissionKeys(permissions);
  } catch (error) {
    throw AthenaAuthRuntimeError.badRequest(
      error instanceof Error ? error.message : "Invalid API key permissions"
    );
  }
  const snapshot = await buildSnapshot(stores, {
    session: { active_organization_id: activeOrganizationId },
    user,
  });
  const authorization = bindApiKeyAuthorization(
    snapshot,
    requestedRights,
    scopeKind
  );
  const missingRights = requestedRights.filter(
    (right) =>
      !authorization.effectiveRights.some((ownedRight) =>
        rightMatches(ownedRight, right)
      )
  );
  if (missingRights.length > 0) {
    throw AthenaAuthRuntimeError.forbidden(
      "API key permissions exceed the authenticated principal's rights"
    );
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
