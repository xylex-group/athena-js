import { PACKAGE_VERSION } from "../../sdk-version.ts";
import {
  type NormalizedAthenaAuthConfig,
  normalizeAthenaAuthConfig,
} from "../config.ts";
import {
  ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
  ATHENA_AUTH_DEFAULT_BASE_PATH,
  ATHENA_AUTH_SCHEMA_GENERATION,
} from "../contract/index.ts";
import {
  createClearSessionCookieHeader,
  createSessionCookieHeader,
  readBearerToken,
  readSessionTokenFromCookies,
  shouldSetSecureCookie,
} from "./cookies.ts";
import {
  type AthenaAuthDatabase,
  createPostgresAuthDatabase,
} from "./database.ts";
import {
  AthenaAuthRuntimeError,
  createTraceId,
  errorResponse,
  jsonResponse,
} from "./errors.ts";
import { resolveRuntimeKey } from "./keyring.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import {
  toPublicAccount,
  toPublicInvitation,
  toPublicMember,
  toPublicOrganization,
  toPublicSession,
  toPublicUser,
} from "./models.ts";
import {
  createArgon2PasswordHasher,
  extractPasswordHash,
  type AthenaAuthPasswordHasher,
  validatePassword,
  withPasswordHash,
} from "./password.ts";
import {
  assertAthenaAuthSchemaCompatible,
  migrateAthenaAuthSchema,
  readAthenaAuthSchemaStatus,
  toAthenaAuthSchemaCompatibility,
} from "./schema.ts";
import {
  asStringField,
  enforceOrigin,
  MemoryRateLimiter,
  readJsonBody,
  requestClientIp,
  requireStringField,
} from "./security.ts";
import type { AthenaAuthEmailProvider } from "../email/contract.ts";
import { handleExtendedRoute, resolveApiKeyUser } from "./extended-routes.ts";
import { handleAdminRoute } from "./admin-routes.ts";
import { isUserEffectivelyBanned } from "./admin-contract.ts";
import {
  MemoryAdminAuthStore,
  PostgresAdminAuthStore,
} from "./admin-store.ts";
import { createLocalTokenAuthority } from "./token-authority.ts";
import { handleAdminEmailRoutes } from "./email/routes.ts";
import { PostgresAuthEmailStore } from "./email/postgres-store.ts";
import { MemoryAuthEmailStore, type AthenaAuthEmailStore } from "./email/store.ts";
import { PostgresAuthStores } from "./stores.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";

export interface AthenaAuthHttpHandlers {
  DELETE: (request: Request) => Promise<Response>;
  GET: (request: Request) => Promise<Response>;
  HEAD: (request: Request) => Promise<Response>;
  OPTIONS: (request: Request) => Promise<Response>;
  PATCH: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
  PUT: (request: Request) => Promise<Response>;
}

export interface AthenaAuthServerSurface {
  handle(request: Request): Promise<Response>;
  handlers: AthenaAuthHttpHandlers;
  migrate(): Promise<void>;
}

export interface CreateAthenaAuthRuntimeOptions {
  autoMigrate?: boolean;
  basePath?: string;
  config?: NormalizedAthenaAuthConfig;
  database?: AthenaAuthDatabase | string;
  email?: {
    provider?: AthenaAuthEmailProvider;
    send?: (message: {
      subject: string;
      to: string;
      type: string;
      url?: string;
    }) => Promise<void> | void;
  };
  hasher?: AthenaAuthPasswordHasher;
  secret?: string;
  stores?: AthenaAuthStores;
}

export interface AthenaAuthRuntime extends AthenaAuthServerSurface {
  close(): Promise<void>;
  readonly config: NormalizedAthenaAuthConfig;
  getStores(): Promise<AthenaAuthStores>;
}

function createSessionToken(): string {
  return `session_${crypto.randomUUID()}`;
}

function normalizePath(pathname: string, basePath: string): string {
  const normalizedBase = basePath.replace(/\/+$/, "") || "";
  let path = pathname;
  if (normalizedBase && (path === normalizedBase || path.startsWith(`${normalizedBase}/`))) {
    path = path.slice(normalizedBase.length) || "/";
  }
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505"
  );
}

export function createAthenaAuthRuntime(
  options: CreateAthenaAuthRuntimeOptions = {}
): AthenaAuthRuntime {
  const config =
    options.config ??
    normalizeAthenaAuthConfig({
      basePath: options.basePath,
      mode: "local",
      secret: options.secret,
    });
  const hasher = options.hasher ?? createArgon2PasswordHasher();
  const rateLimiter = new MemoryRateLimiter(20, 60_000);
  const memoryStores = options.stores ?? (options.database ? undefined : new MemoryAuthStores());
  let database: AthenaAuthDatabase | undefined =
    typeof options.database === "string" ? undefined : options.database;
  const connectionString =
    typeof options.database === "string" ? options.database : undefined;
  let stores: AthenaAuthStores | undefined = memoryStores;
  let ready: Promise<void> | undefined;
  const ownsDatabase = typeof options.database === "string";
  let emailStore: AthenaAuthEmailStore = new MemoryAuthEmailStore();
  let tokenAuthority: Awaited<ReturnType<typeof createLocalTokenAuthority>> | undefined;

  const ensureReady = async (): Promise<AthenaAuthStores> => {
    if (!ready) {
      ready = (async () => {
        if (!stores) {
          if (!database) {
            if (!connectionString) {
              throw AthenaAuthRuntimeError.internal(
                new Error("Local Athena Auth requires a database")
              );
            }
            database = await createPostgresAuthDatabase(connectionString);
          }
          if (options.autoMigrate === true) {
            await migrateAthenaAuthSchema(database);
          } else {
            await assertAthenaAuthSchemaCompatible(database);
          }
          await resolveRuntimeKey(database, options.secret ?? config.secret);
          stores = new PostgresAuthStores(database);
          emailStore = new PostgresAuthEmailStore(database);
        }
      })();
    }
    await ready;
    if (!stores) {
      throw AthenaAuthRuntimeError.internal(new Error("Auth stores were not initialized"));
    }
    return stores;
  };

  const resolveSession = async (
    request: Request,
    currentStores: AthenaAuthStores
  ) => {
    const token =
      readBearerToken(request.headers.get("authorization")) ??
      readSessionTokenFromCookies(
        request.headers.get("cookie"),
        config.session.cookieName
      );
    if (!token) {
      return undefined;
    }
    const session = await currentStores.getSessionByToken(token);
    if (!session) {
      return undefined;
    }
    const user = await currentStores.getUserById(session.user_id);
    if (!user) {
      return undefined;
    }
    if (user.banned && !isUserEffectivelyBanned(user)) {
      await currentStores.updateUser(user.id, {
        banned: false,
        banExpires: null,
        banReason: null,
      });
      user.banned = false;
      user.ban_expires = null;
      user.ban_reason = null;
    } else if (isUserEffectivelyBanned(user)) {
      return undefined;
    }
    if (
      !config.session.disableSessionRefresh &&
      Date.now() - new Date(session.updated_at).getTime() >=
        config.session.updateAgeSeconds * 1000
    ) {
      const expiresAt = new Date(
        Date.now() + config.session.expiresInSeconds * 1000
      );
      await currentStores.updateSessionExpiry(token, expiresAt);
      session.expires_at = expiresAt;
      session.updated_at = new Date();
    }
    return { session, token, user };
  };

  const requireSession = async (
    request: Request,
    currentStores: AthenaAuthStores
  ) => {
    const resolved = await resolveSession(request, currentStores);
    if (!resolved) {
      if (
        readBearerToken(request.headers.get("authorization")) ||
        readSessionTokenFromCookies(
          request.headers.get("cookie"),
          config.session.cookieName
        )
      ) {
        throw AthenaAuthRuntimeError.sessionNotFound();
      }
      throw AthenaAuthRuntimeError.unauthenticated();
    }
    return resolved;
  };

  const issueSession = async (
    request: Request,
    currentStores: AthenaAuthStores,
    userId: string,
    headers: Headers
  ) => {
    const expiresAt = new Date(
      Date.now() + config.session.expiresInSeconds * 1000
    );
    const session = await currentStores.createSession({
      expiresAt,
      id: crypto.randomUUID(),
      ipAddress: requestClientIp(request, config.security.trustedProxy),
      token: createSessionToken(),
      userAgent: request.headers.get("user-agent"),
      userId,
    });
    await currentStores.updateUser(userId, { lastSignInAt: new Date() });
    headers.append(
      "set-cookie",
      createSessionCookieHeader(session.token, {
        cookieName: config.session.cookieName,
        expiresAt,
        secure: shouldSetSecureCookie(request, config.security.cookieSecure),
      })
    );
    return session;
  };

  const handleRoute = async (
    request: Request,
    path: string,
    currentStores: AthenaAuthStores,
    headers: Headers
  ): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      return new Response(null, { headers, status: 204 });
    }
    if (method === "HEAD" && path === "/ok") {
      return new Response(null, { headers, status: 200 });
    }

    if (path === "/ok" && method === "GET") {
      return jsonResponse(200, { ok: true }, headers);
    }
    if (path === "/health" && method === "GET") {
      const schema = database
        ? await readAthenaAuthSchemaStatus(database)
        : toAthenaAuthSchemaCompatibility(ATHENA_AUTH_SCHEMA_GENERATION);
      return jsonResponse(
        200,
        {
          schema,
          service: "athena-auth",
          status: "ok",
          version: PACKAGE_VERSION,
        },
        headers
      );
    }

    const tokenPath =
      path === "/get-access-token" || path === "/refresh-token"
        ? "/token"
        : path;
    if (
      path === "/token" ||
      path === "/get-access-token" ||
      path === "/refresh-token" ||
      path === "/.well-known/jwks.json" ||
      path === "/.well-known/openid-configuration"
    ) {
      tokenAuthority ??= await createLocalTokenAuthority({
        audiences: ["athena", "neon"],
        issuer: new URL(request.url).origin,
        tokenEndpoint: `${new URL(request.url).origin}${config.basePath === "/" ? "" : config.basePath}/token`,
      });
      const session =
        tokenPath === "/token"
          ? await resolveSession(request, currentStores)
          : null;
      const tokenResponse = await tokenAuthority.handle(
        tokenPath,
        method,
        request,
        session ?? null
      );
      if (tokenResponse) {
        return tokenResponse;
      }
    }

    if (path === "/get-session" && (method === "GET" || method === "POST")) {
      const resolved = await resolveSession(request, currentStores);
      if (resolved) {
        return jsonResponse(
          200,
          {
            grants: {},
            rights: {},
            session: toPublicSession(resolved.session),
            user: toPublicUser(resolved.user),
          },
          headers
        );
      }
      const apiKeyUser = await resolveApiKeyUser(request, currentStores);
      if (apiKeyUser) {
        return jsonResponse(
          200,
          {
            grants: {},
            rights: {},
            session: {
              id: `api-key:${apiKeyUser.id}`,
              token: null,
              userId: apiKeyUser.id,
            },
            user: toPublicUser(apiKeyUser),
          },
          headers
        );
      }
      throw AthenaAuthRuntimeError.unauthenticated();
    }

    if (path === "/sign-up/email" && method === "POST") {
      if (!config.emailAndPassword.enabled) {
        throw AthenaAuthRuntimeError.forbidden("User registration is not enabled");
      }
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const email = requireStringField(body, "email");
      const password = requireStringField(body, "password");
      validatePassword(password, {
        maxLength: config.emailAndPassword.maxPasswordLength,
        minLength: config.emailAndPassword.minPasswordLength,
      });
      if (await currentStores.getUserByEmail(email)) {
        throw AthenaAuthRuntimeError.conflict(
          "A user with this email already exists"
        );
      }
      const hash = await hasher.hash(password);
      let user;
      try {
        user = await currentStores.createUser({
          email,
          id: crypto.randomUUID(),
          metadata: withPasswordHash({}, hash),
          name:
            asStringField(body, "name") ??
            email.split("@")[0] ??
            email,
          username: asStringField(body, "username"),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw AthenaAuthRuntimeError.conflict(
            "A user with this email already exists"
          );
        }
        throw error;
      }
      await currentStores.createAccount({
        accountId: user.id,
        id: crypto.randomUUID(),
        password: hash,
        providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
        userId: user.id,
      });
      if (!config.emailAndPassword.autoSignIn) {
        return jsonResponse(
          200,
          { session: null, token: null, user: toPublicUser(user) },
          headers
        );
      }
      const session = await issueSession(request, currentStores, user.id, headers);
      const refreshed = (await currentStores.getUserById(user.id)) ?? user;
      return jsonResponse(
        200,
        {
          session: toPublicSession(session),
          token: session.token,
          user: toPublicUser(refreshed),
        },
        headers
      );
    }

    if (
      (path === "/sign-in/email" || path === "/sign-in/username") &&
      method === "POST"
    ) {
      const ip =
        requestClientIp(request, config.security.trustedProxy) ?? "local";
      if (!rateLimiter.consume(`signin:${ip}`)) {
        throw AthenaAuthRuntimeError.rateLimited();
      }
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const password = requireStringField(body, "password");
      const user =
        path === "/sign-in/username"
          ? await currentStores.getUserByUsername(
              requireStringField(body, "username")
            )
          : await currentStores.getUserByEmail(requireStringField(body, "email"));
      if (!user) {
        throw AthenaAuthRuntimeError.invalidCredentials();
      }
      if (user.banned && !isUserEffectivelyBanned(user)) {
        await currentStores.updateUser(user.id, {
          banned: false,
          banExpires: null,
          banReason: null,
        });
        user.banned = false;
        user.ban_expires = null;
        user.ban_reason = null;
      } else if (isUserEffectivelyBanned(user)) {
        throw AthenaAuthRuntimeError.forbidden("User is banned");
      }
      const storedHash =
        extractPasswordHash(user.metadata) ??
        (await currentStores.listAccounts(user.id)).find(
          (account) => account.provider_id === ATHENA_AUTH_CREDENTIAL_PROVIDER_ID
        )?.password;
      if (!storedHash || !(await hasher.verify(password, storedHash))) {
        throw AthenaAuthRuntimeError.invalidCredentials();
      }
      if (hasher.needsRehash(storedHash)) {
        const nextHash = await hasher.hash(password);
        await currentStores.updateUser(user.id, {
          metadata: withPasswordHash(
            typeof user.metadata === "object" ? user.metadata : {},
            nextHash
          ),
        });
      }
      if (user.two_factor_enabled) {
        const pendingToken = `2fa_${crypto.randomUUID()}`;
        await currentStores.createVerification({
          expiresAt: new Date(Date.now() + 5 * 60 * 1000),
          id: crypto.randomUUID(),
          identifier: `2fa_pending:${user.id}`,
          value: pendingToken,
        });
        return jsonResponse(
          200,
          {
            token: pendingToken,
            twoFactorRedirect: true,
          },
          headers
        );
      }
      const session = await issueSession(request, currentStores, user.id, headers);
      const refreshed = (await currentStores.getUserById(user.id)) ?? user;
      return jsonResponse(
        200,
        {
          redirect: false,
          session: toPublicSession(session),
          token: session.token,
          url: null,
          user: toPublicUser(refreshed),
        },
        headers
      );
    }

    if (path === "/sign-out" && method === "POST") {
      const token =
        readBearerToken(request.headers.get("authorization")) ??
        readSessionTokenFromCookies(
          request.headers.get("cookie"),
          config.session.cookieName
        );
      if (token) {
        await currentStores.deleteSession(token);
      }
      headers.append(
        "set-cookie",
        createClearSessionCookieHeader(
          config.session.cookieName,
          shouldSetSecureCookie(request, config.security.cookieSecure)
        )
      );
      return jsonResponse(200, { success: true }, headers);
    }

    if (path === "/forget-password" && method === "POST") {
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const email = requireStringField(body, "email");
      const user = await currentStores.getUserByEmail(email);
      if (user) {
        const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
          "base64url"
        );
        await currentStores.createVerification({
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          id: crypto.randomUUID(),
          identifier: `reset:${user.email ?? email}`,
          value: token,
        });
        await options.email?.send?.({
          subject: "Reset your password",
          to: email,
          type: "reset-password",
          url: asStringField(body, "redirectTo")
            ? `${asStringField(body, "redirectTo")}?token=${token}`
            : token,
        });
      }
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/reset-password" && method === "POST") {
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const token = requireStringField(body, "token");
      const newPassword =
        asStringField(body, "newPassword") ??
        requireStringField(body, "password");
      validatePassword(newPassword, {
        maxLength: config.emailAndPassword.maxPasswordLength,
        minLength: config.emailAndPassword.minPasswordLength,
      });
      const verification = await currentStores.consumeVerification(token);
      if (!verification) {
        throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
      }
      const email = verification.identifier.replace(/^reset:/, "");
      const user = await currentStores.getUserByEmail(email);
      if (!user) {
        throw AthenaAuthRuntimeError.notFound("User not found");
      }
      const hash = await hasher.hash(newPassword);
      await currentStores.updateUser(user.id, {
        metadata: withPasswordHash(
          typeof user.metadata === "object" ? user.metadata : {},
          hash
        ),
      });
      await currentStores.deleteUserSessions(user.id);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/change-password" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const currentPassword = requireStringField(body, "currentPassword");
      const newPassword = requireStringField(body, "newPassword");
      validatePassword(newPassword, {
        maxLength: config.emailAndPassword.maxPasswordLength,
        minLength: config.emailAndPassword.minPasswordLength,
      });
      const storedHash = extractPasswordHash(resolved.user.metadata);
      if (!storedHash || !(await hasher.verify(currentPassword, storedHash))) {
        throw AthenaAuthRuntimeError.invalidCredentials();
      }
      const hash = await hasher.hash(newPassword);
      await currentStores.updateUser(resolved.user.id, {
        metadata: withPasswordHash(
          typeof resolved.user.metadata === "object" ? resolved.user.metadata : {},
          hash
        ),
      });
      if (body.revokeOtherSessions) {
        await currentStores.deleteUserSessions(resolved.user.id, resolved.token);
      }
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/set-password" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const newPassword =
        asStringField(body, "newPassword") ??
        requireStringField(body, "password");
      validatePassword(newPassword, {
        maxLength: config.emailAndPassword.maxPasswordLength,
        minLength: config.emailAndPassword.minPasswordLength,
      });
      const hash = await hasher.hash(newPassword);
      await currentStores.updateUser(resolved.user.id, {
        metadata: withPasswordHash(
          typeof resolved.user.metadata === "object" ? resolved.user.metadata : {},
          hash
        ),
      });
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/update-user" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const updated = await currentStores.updateUser(resolved.user.id, {
        image: asStringField(body, "image") ?? undefined,
        name: asStringField(body, "name"),
      });
      return jsonResponse(200, { user: toPublicUser(updated) }, headers);
    }

    if (path === "/list-sessions" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const sessions = await currentStores.listUserSessions(resolved.user.id);
      return jsonResponse(
        200,
        sessions.map((session) => toPublicSession(session)),
        headers
      );
    }

    if (path === "/revoke-session" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const token = requireStringField(body, "token");
      const target = await currentStores.getSessionByToken(token);
      if (target && target.user_id !== resolved.user.id) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      await currentStores.deleteSession(token);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/revoke-sessions" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      await currentStores.deleteUserSessions(resolved.user.id);
      headers.append(
        "set-cookie",
        createClearSessionCookieHeader(
          config.session.cookieName,
          shouldSetSecureCookie(request, config.security.cookieSecure)
        )
      );
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/revoke-other-sessions" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      await currentStores.deleteUserSessions(resolved.user.id, resolved.token);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/list-accounts" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const accounts = await currentStores.listAccounts(resolved.user.id);
      return jsonResponse(
        200,
        accounts.map((account) => toPublicAccount(account)),
        headers
      );
    }

    if (path === "/organization/create" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const name = requireStringField(body, "name");
      const slug =
        asStringField(body, "slug") ??
        name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      let organization;
      try {
        organization = await currentStores.createOrganization({
          id: crypto.randomUUID(),
          name,
          slug,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw AthenaAuthRuntimeError.conflict("Organization slug already exists");
        }
        throw error;
      }
      await currentStores.addMember({
        id: crypto.randomUUID(),
        organizationId: organization.id,
        role: "owner",
        userId: resolved.user.id,
      });
      await currentStores.setSessionActiveOrganization(
        resolved.token,
        organization.id
      );
      return jsonResponse(
        200,
        { organization: toPublicOrganization(organization) },
        headers
      );
    }

    if (path === "/organization/list" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const organizations = await currentStores.listOrganizationsForUser(
        resolved.user.id
      );
      return jsonResponse(
        200,
        organizations.map((organization) => toPublicOrganization(organization)),
        headers
      );
    }

    if (path === "/organization/get-full-organization" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const url = new URL(request.url);
      const organizationId =
        url.searchParams.get("organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const organization = await currentStores.getOrganization(organizationId);
      if (!organization) {
        throw AthenaAuthRuntimeError.notFound("Organization not found");
      }
      const members = await currentStores.listMembers(organizationId);
      return jsonResponse(
        200,
        {
          ...toPublicOrganization(organization),
          members: members.map((item) => toPublicMember(item)),
        },
        headers
      );
    }

    if (path === "/organization/update" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId =
        asStringField(body, "organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member || (member.role !== "owner" && member.role !== "admin")) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const organization = await currentStores.updateOrganization(organizationId, {
        logo: asStringField(body, "logo"),
        name: asStringField(body, "name"),
        slug: asStringField(body, "slug"),
      });
      return jsonResponse(
        200,
        { organization: toPublicOrganization(organization) },
        headers
      );
    }

    if (path === "/organization/delete" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId = requireStringField(body, "organizationId");
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member || member.role !== "owner") {
        throw AthenaAuthRuntimeError.forbidden();
      }
      await currentStores.deleteOrganization(organizationId);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/set-active" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId = asStringField(body, "organizationId") ?? null;
      if (organizationId) {
        const member = await currentStores.getMember(
          organizationId,
          resolved.user.id
        );
        if (!member) {
          throw AthenaAuthRuntimeError.forbidden();
        }
      }
      await currentStores.setSessionActiveOrganization(
        resolved.token,
        organizationId
      );
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/list-members" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const organizationId =
        new URL(request.url).searchParams.get("organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const members = await currentStores.listMembers(organizationId);
      return jsonResponse(
        200,
        { members: members.map((item) => toPublicMember(item)) },
        headers
      );
    }

    if (path === "/organization/remove-member" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId =
        asStringField(body, "organizationId") ??
        resolved.session.active_organization_id;
      const memberIdOrUserId =
        asStringField(body, "memberIdOrEmail") ??
        requireStringField(body, "memberId");
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const actor = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const members = await currentStores.listMembers(organizationId);
      const target =
        members.find((item) => item.id === memberIdOrUserId) ??
        members.find((item) => item.user_id === memberIdOrUserId);
      if (!target) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      await currentStores.removeMember(organizationId, target.user_id);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/update-member-role" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId =
        asStringField(body, "organizationId") ??
        resolved.session.active_organization_id;
      const role = requireStringField(body, "role");
      const memberId = requireStringField(body, "memberId");
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const actor = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!actor || actor.role !== "owner") {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const members = await currentStores.listMembers(organizationId);
      const target =
        members.find((item) => item.id === memberId) ??
        members.find((item) => item.user_id === memberId);
      if (!target) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      const updated = await currentStores.updateMemberRole(
        organizationId,
        target.user_id,
        role
      );
      return jsonResponse(
        200,
        { member: updated ? toPublicMember(updated) : toPublicMember(target) },
        headers
      );
    }

    if (path === "/organization/leave" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId =
        asStringField(body, "organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      await currentStores.removeMember(organizationId, resolved.user.id);
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/invite-member" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId =
        asStringField(body, "organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const actor = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const invitation = await currentStores.createInvitation({
        email: requireStringField(body, "email"),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        id: crypto.randomUUID(),
        inviterId: resolved.user.id,
        organizationId,
        role: asStringField(body, "role") ?? "member",
      });
      return jsonResponse(
        200,
        { invitation: toPublicInvitation(invitation) },
        headers
      );
    }

    if (path === "/organization/accept-invitation" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const invitationId = requireStringField(body, "invitationId");
      const invitation = await currentStores.getInvitation(invitationId);
      if (
        !invitation ||
        invitation.status !== "pending" ||
        new Date(invitation.expires_at).getTime() <= Date.now()
      ) {
        throw AthenaAuthRuntimeError.badRequest("Invitation is not valid");
      }
      if (
        invitation.email &&
        resolved.user.email &&
        invitation.email !== resolved.user.email
      ) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const existing = await currentStores.getMember(
        invitation.organization_id,
        resolved.user.id
      );
      if (!existing) {
        await currentStores.addMember({
          id: crypto.randomUUID(),
          organizationId: invitation.organization_id,
          role: invitation.role,
          userId: resolved.user.id,
        });
      }
      await currentStores.updateInvitationStatus(invitation.id, "accepted");
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/cancel-invitation" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const invitationId = requireStringField(body, "invitationId");
      const invitation = await currentStores.getInvitation(invitationId);
      if (!invitation) {
        throw AthenaAuthRuntimeError.notFound("Invitation not found");
      }
      const actor = await currentStores.getMember(
        invitation.organization_id,
        resolved.user.id
      );
      if (!actor || (actor.role !== "owner" && actor.role !== "admin")) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      await currentStores.updateInvitationStatus(invitation.id, "canceled");
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/list-invitations" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const organizationId =
        new URL(request.url).searchParams.get("organizationId") ??
        resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const invitations = await currentStores.listInvitations(organizationId);
      return jsonResponse(
        200,
        invitations.map((invitation) => toPublicInvitation(invitation)),
        headers
      );
    }

    if (path === "/organization/check-slug" && method === "POST") {
      await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const slug = requireStringField(body, "slug");
      const existing = await currentStores.getOrganizationBySlug(slug);
      return jsonResponse(200, { status: !existing }, headers);
    }

    if (path === "/organization/has-permission" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const organizationId =
        asStringField(
          await readJsonBody(request, config.security.bodyLimitBytes).catch(
            () => ({})
          ),
          "organizationId"
        ) ?? resolved.session.active_organization_id;
      if (!organizationId) {
        return jsonResponse(200, { success: false, error: "No organization" }, headers);
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      return jsonResponse(
        200,
        { success: Boolean(member), error: member ? undefined : "Forbidden" },
        headers
      );
    }

    if (path === "/organization/get-active-member" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const organizationId = resolved.session.active_organization_id;
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("No active organization");
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!member) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      return jsonResponse(200, { member: toPublicMember(member) }, headers);
    }

    if (path === "/organization/get-invitation" && method === "GET") {
      await requireSession(request, currentStores);
      const invitationId = new URL(request.url).searchParams.get("invitationId");
      if (!invitationId) {
        throw AthenaAuthRuntimeError.badRequest("invitationId is required");
      }
      const invitation = await currentStores.getInvitation(invitationId);
      if (!invitation) {
        throw AthenaAuthRuntimeError.notFound("Invitation not found");
      }
      return jsonResponse(
        200,
        { invitation: toPublicInvitation(invitation) },
        headers
      );
    }

    if (path === "/organization/list-user-invitations" && method === "GET") {
      const resolved = await requireSession(request, currentStores);
      const email = resolved.user.email;
      const invitations = email
        ? await currentStores.listInvitationsForEmail(email)
        : [];
      return jsonResponse(
        200,
        invitations.map((invitation) => toPublicInvitation(invitation)),
        headers
      );
    }

    if (path === "/organization/reject-invitation" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const invitationId = requireStringField(body, "invitationId");
      const invitation = await currentStores.getInvitation(invitationId);
      if (!invitation) {
        throw AthenaAuthRuntimeError.notFound("Invitation not found");
      }
      const actor = await currentStores.getMember(
        invitation.organization_id,
        resolved.user.id
      );
      const isInvitee =
        invitation.email &&
        resolved.user.email &&
        invitation.email === resolved.user.email;
      if (!(isInvitee || (actor && (actor.role === "owner" || actor.role === "admin")))) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      await currentStores.updateInvitationStatus(invitation.id, "rejected");
      return jsonResponse(200, { status: true }, headers);
    }

    const emailAdmin = await handleAdminEmailRoutes(request, path, method, {
      emailStore,
      headers,
      provider: options.email?.provider,
      requireSession,
      stores: currentStores,
    });
    if (emailAdmin) {
      return emailAdmin;
    }

    const adminStore = database
      ? new PostgresAdminAuthStore(database)
      : currentStores instanceof MemoryAuthStores
        ? new MemoryAdminAuthStore(currentStores)
        : undefined;
    if (adminStore && path.startsWith("/admin/")) {
      const adminResponse = await handleAdminRoute(request, path, method, {
        config,
        hasher,
        headers,
        issueSession: (adminRequest, userId) =>
          issueSession(adminRequest, currentStores, userId, headers),
        requireSession: (adminRequest) =>
          requireSession(adminRequest, currentStores),
        store: adminStore,
      });
      if (adminResponse) {
        return adminResponse;
      }
    }

    const extended = await handleExtendedRoute(request, path, method, {
      config,
      email: options.email,
      hasher,
      headers,
      issueSession,
      requireSession,
      stores: currentStores,
    });
    if (extended) {
      return extended;
    }

    throw AthenaAuthRuntimeError.notFound("Not found");
  };

  const handle = async (request: Request): Promise<Response> => {
    const traceId =
      request.headers.get("x-athena-trace-id")?.trim() ||
      request.headers.get("x-request-id")?.trim() ||
      createTraceId();
    const headers = new Headers();
    headers.set("x-athena-trace-id", traceId);
    headers.set("x-request-id", traceId);
    try {
      const url = new URL(request.url);
      const path = normalizePath(
        url.pathname,
        config.basePath || ATHENA_AUTH_DEFAULT_BASE_PATH
      );
      enforceOrigin(request, config.security.trustedOrigins);
      const currentStores = await ensureReady();
      return await handleRoute(request, path, currentStores, headers);
    } catch (error) {
      return errorResponse(error, traceId);
    }
  };

  const handlers: AthenaAuthHttpHandlers = {
    DELETE: handle,
    GET: handle,
    HEAD: handle,
    OPTIONS: handle,
    PATCH: handle,
    POST: handle,
    PUT: handle,
  };

  return {
    close: async () => {
      if (ownsDatabase) {
        await database?.close?.();
      }
    },
    config,
    getStores: ensureReady,
    handle,
    handlers,
    migrate: async () => {
      if (!database) {
        if (!connectionString) {
          return;
        }
        database = await createPostgresAuthDatabase(connectionString);
      }
      await migrateAthenaAuthSchema(database);
    },
  };
}

export function createAthenaAuth(
  options: CreateAthenaAuthRuntimeOptions & { database: string | AthenaAuthDatabase }
): AthenaAuthRuntime {
  return createAthenaAuthRuntime({
    ...options,
    autoMigrate: options.autoMigrate === true,
  });
}

export function createAthenaAuthHttpHandlers(
  runtime: AthenaAuthServerSurface
): AthenaAuthHttpHandlers {
  return runtime.handlers;
}
