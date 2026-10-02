import { ORGANIZATION_MEMBERS_READ } from "../../rights/definitions.ts";
import type { AthenaRightKey } from "../../rights/key.ts";
import { missingRequiredRights } from "../../rights/matching.ts";
import { PACKAGE_VERSION } from "../../sdk-version.ts";
import { createEmbeddedCapabilitySnapshot } from "../capabilities.ts";
import {
  ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
  ATHENA_AUTH_SCHEMA_GENERATION,
} from "../contract/index.ts";
import { authEmailEvents } from "../email/index.ts";
import {
  sanitizeHookMember,
  sanitizeHookOrganization,
  sanitizeHookSession,
  sanitizeHookUser,
} from "../hooks/sanitize.ts";
import { splitPrimaryAndRest } from "../observability/snapshots.ts";
import { isUserEffectivelyBanned } from "./admin-contract.ts";
import { handleAdminRoute } from "./admin-routes.ts";
import { MemoryAdminAuthStore, PostgresAdminAuthStore } from "./admin-store.ts";
import {
  apiKeyScopeKind,
  bindApiKeyAuthorization,
  isApiKeyScopeUsable,
} from "./api-key.ts";
import { handleOrganizationAuthenticationPostureRoute } from "./authentication-posture-routes.ts";
import {
  requireOrganizationRoleGrant,
  requireOrgDelete,
  requireOrgMemberManager,
} from "./authorization-guard.ts";
import {
  buildSnapshot,
  handleAuthorizationRoute,
} from "./authorization-routes.ts";
import { handleAuthorizationServerRoutes } from "./authorization-server/routes.ts";
import { revokeAuthBridgeCodesForSessions } from "./bridge/revoke.ts";
import { handleAuthBridgeRoutes } from "./bridge/routes.ts";
import {
  createClearSessionCookieHeader,
  readBearerToken,
  readSessionTokenFromCookies,
  shouldSetSecureCookie,
} from "./cookies.ts";
import { handleCredentialPasswordRoutes } from "./credential-password-routes.ts";
import { handleAdminEmailRoutes } from "./email/routes.ts";
import { handleUserMailRoutes, tokenizedUrl } from "./email/user-routes.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import { handleExtendedRoute, resolveApiKeyUser } from "./extended-routes.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import { MemoryAuthStores } from "./memory-stores.ts";
import type { AuthOrganizationRow, AuthUserRow } from "./models.ts";
import {
  toPublicAccount,
  toPublicMember,
  toPublicMembersWithUsers,
  toPublicMemberWithUser,
  toPublicOrganization,
  toPublicSession,
  toPublicUser,
} from "./models.ts";
import {
  assertFoundingOwnerMutationAllowed,
  assertLastOwnerMutationAllowed,
  resolveFoundingOwnerUserId,
} from "./organization-invariants.ts";
import { handleOrganizationInvitationRoutes } from "./organization-invitation-routes.ts";
import { handleOrganizationLifecycleEventRoute } from "./organization-lifecycle-event-routes.ts";
import { handleIdentityConnectionAdminRoute } from "./identity-connections/admin-routes.ts";
import { requireIdentityConnectionForEmail } from "./identity-connections/policy.ts";
import { handleGenerateAuthenticateOptionsRoute } from "./passkey/generate-authenticate-options.ts";
import { handleGenerateRegisterOptionsRoute } from "./passkey/generate-register-options.ts";
import {
  handleDeletePasskeyRoute,
  handleListUserPasskeysRoute,
  handleUpdatePasskeyRoute,
} from "./passkey/manage-passkeys.ts";
import { handleRelatedOriginsRoute } from "./passkey/related-origins.ts";
import { handleVerifyAuthenticationRoute } from "./passkey/verify-authentication.ts";
import { handleVerifyRegistrationRoute } from "./passkey/verify-registration.ts";
import {
  extractPasswordHash,
  validatePassword,
  withPasswordHash,
} from "./password.ts";
import { timeAuthSpan } from "./request-timing.ts";
import type { AuthRuntimeDependencies } from "./runtime-dependencies.ts";
import { isUniqueViolation } from "./runtime-helpers.ts";
import {
  readAthenaAuthSchemaStatus,
  toAthenaAuthSchemaCompatibility,
} from "./schema.ts";
import {
  asDataEnvelopeStringField,
  asStringField,
  readJsonBody,
  requestClientIp,
  requireStringField,
} from "./security.ts";
import { handleSocialRoutes } from "./social/routes.ts";
import { advertisedSocialProviderIds } from "./social/runtime.ts";

export type AuthRouteDomain =
  | "authorization-server"
  | "session"
  | "credential"
  | "user"
  | "organization"
  | "passkey"
  | "token"
  | "email"
  | "admin"
  | "social";

export type AuthRouteHandler = (
  request: Request,
  path: string,
  method: string,
  currentStores: AthenaAuthStores,
  headers: Headers,
  traceId: string
) => Promise<Response | undefined>;

type AthenaSessionEnvelope = {
  authorization?: Awaited<ReturnType<typeof buildSnapshot>>;
  grants: readonly string[];
  rights: readonly AthenaRightKey[];
  session: Pick<ReturnType<typeof toPublicSession>, "id" | "userId"> &
    Partial<
      Omit<ReturnType<typeof toPublicSession>, "id" | "userId" | "token">
    > & {
      token: string | null;
    };
  user: ReturnType<typeof toPublicUser>;
};

function resolveAuthRouteDomain(path: string): AuthRouteDomain | undefined {
  if (path.startsWith("/admin/authorization-server/")) {
    return "authorization-server";
  }
  if (
    path === "/oauth/authorize" ||
    path === "/oauth/token" ||
    path === "/userinfo" ||
    path === "/oauth/revoke" ||
    path === "/.well-known/openid-configuration" ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/authorization/grants" ||
    /^\/authorization\/grants\/[^/]+\/revoke$/.test(path)
  ) {
    return "authorization-server";
  }
  if (
    path === "/sign-in/social" ||
    path === "/link-social" ||
    path === "/unlink-account" ||
    path.startsWith("/callback/")
  ) {
    return "social";
  }
  if (
    path === "/forget-password" ||
    path === "/reset-password" ||
    path === "/change-password" ||
    path === "/set-password" ||
    path.startsWith("/sign-up") ||
    path.startsWith("/sign-in") ||
    path.startsWith("/send-sign-in") ||
    path.startsWith("/send-security")
  ) {
    return "credential";
  }
  if (path.startsWith("/organization")) {
    return "organization";
  }
  if (path.startsWith("/admin/")) {
    return "admin";
  }
  if (path.startsWith("/passkey") || path.includes("webauthn")) {
    return "passkey";
  }
  if (
    path === "/token" ||
    path === "/get-access-token" ||
    path === "/refresh-token" ||
    path.startsWith("/.well-known/")
  ) {
    return "token";
  }
  if (
    path.startsWith("/email") ||
    path.startsWith("/change-email") ||
    path.includes("verification")
  ) {
    return "email";
  }
  if (
    path === "/get-session" ||
    path === "/sign-out" ||
    path.includes("session") ||
    path.startsWith("/authorization")
  ) {
    return "session";
  }
  if (path === "/update-user" || path === "/list-accounts") {
    return "user";
  }
}

export function createAuthRouter(deps: AuthRuntimeDependencies) {
  const domains: Record<AuthRouteDomain, AuthRouteHandler[]> = {
    admin: [],
    "authorization-server": [],
    credential: [],
    email: [],
    organization: [],
    passkey: [],
    session: [],
    social: [],
    token: [],
    user: [],
  };

  function route(domain: AuthRouteDomain, handler: AuthRouteHandler) {
    domains[domain].push(handler);
  }

  route("credential", async (request, path, method, stores, headers, traceId) =>
    handleCredentialPasswordRoutes(request, path, method, {
      deps,
      headers,
      stores,
      traceId,
    })
  );
  route(
    "organization",
    async (request, path, method, stores, headers, traceId) =>
      handleOrganizationInvitationRoutes(request, path, method, {
        deps,
        headers,
        stores,
        traceId,
      })
  );
  route("session", async (request, path, method, stores, headers, traceId) =>
    handleAuthBridgeRoutes(request, path, method, {
      deps,
      headers,
      stores,
      traceId,
    })
  );
  route("social", async (request, path, method, stores, headers, traceId) =>
    handleSocialRoutes(request, path, method, {
      deps,
      headers,
      stores,
      traceId,
    })
  );
  route(
    "authorization-server",
    async (request, path, method, stores, headers, traceId) =>
      handleAuthorizationServerRoutes(request, path, method, {
        deps,
        headers,
        stores,
        traceId,
      })
  );

  const handleCore = async (
    request: Request,
    path: string,
    currentStores: AthenaAuthStores,
    headers: Headers,
    traceId: string
  ): Promise<Response> => {
    const {
      config,
      hasher,
      mutate,
      hookRequest,
      issueSession,
      requireSession,
      resolveSession,
      emitMail,
      emitIfRecipient,
      identityOf,
      passkeyOnboarding,
      passkeyRelyingParty,
      rateLimiter,
    } = deps;
    const database = deps.getDatabase();
    const emailStore = deps.getEmailStore();
    const delivery = deps.getDelivery();
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      headers.set(
        "Access-Control-Expose-Headers",
        "Server-Timing, X-Athena-Time, x-athena-trace-id, x-request-id"
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "content-type, authorization, cookie, x-athena-sdk, x-athena-trace-id, x-request-id"
      );
      return new Response(null, { headers, status: 204 });
    }
    if (method === "HEAD" && path === "/ok") {
      return new Response(null, { headers, status: 200 });
    }

    if (path === "/ok" && method === "GET") {
      return jsonResponse(
        200,
        {
          capabilities: createEmbeddedCapabilitySnapshot({
            passkeyEnabled: config.passkey.enabled,
            passkeyOnboarding: config.passkey.onboardingEnabled,
            socialProviders: advertisedSocialProviderIds(config.social),
          }),
          ok: true,
        },
        headers
      );
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
      const protocol = await deps.getProtocolRuntime();
      deps.setTokenAuthority(protocol.legacyToken);
      const session =
        tokenPath === "/token"
          ? await resolveSession(request, currentStores)
          : null;
      const tokenResponse = await protocol.legacyToken.handle(
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
      // AUTH-ORG-CTX-001: resolveSession heals a stale activeOrganizationId.
      const resolved = await resolveSession(request, currentStores);
      if (resolved) {
        const authorization = await buildSnapshot(currentStores, resolved);
        const sessionEnvelope: AthenaSessionEnvelope = {
          authorization,
          grants: [],
          rights: authorization.effectiveRights,
          session: toPublicSession(resolved.session),
          user: toPublicUser(resolved.user),
        };
        return jsonResponse(200, sessionEnvelope, headers);
      }
      const apiKeyUser = await resolveApiKeyUser(request, currentStores);
      if (
        apiKeyUser &&
        (await isApiKeyScopeUsable(apiKeyUser.key, currentStores))
      ) {
        const ownerAuthorization = await buildSnapshot(currentStores, {
          session: {
            active_organization_id:
              apiKeyScopeKind(apiKeyUser.key) === "organization"
                ? (apiKeyUser.key.organization_id ?? null)
                : null,
          },
          user: apiKeyUser.user,
        });
        const authorization = bindApiKeyAuthorization(
          ownerAuthorization,
          apiKeyUser.permissions,
          apiKeyScopeKind(apiKeyUser.key)
        );
        const sessionEnvelope: AthenaSessionEnvelope = {
          authorization,
          grants: [],
          rights: authorization.effectiveRights,
          session: {
            id: `api-key:${apiKeyUser.user.id}`,
            token: null,
            userId: apiKeyUser.user.id,
          },
          user: toPublicUser(apiKeyUser.user),
        };
        return jsonResponse(200, sessionEnvelope, headers);
      }
      throw AthenaAuthRuntimeError.unauthenticated();
    }

    if (path === "/sign-up/email" && method === "POST") {
      if (!config.emailAndPassword.enabled) {
        throw AthenaAuthRuntimeError.forbidden(
          "User registration is not enabled"
        );
      }
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const email = requireStringField(body, "email");
      await requireIdentityConnectionForEmail(currentStores, email);
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
      const name = asStringField(body, "name") ?? email.split("@")[0] ?? email;
      const username = asStringField(body, "username");
      const created = await mutate({
        context: {
          actor: { kind: "user" },
          request: hookRequest(request, path),
          traceId,
        },
        event: "user.create",
        execute: async (scope) => {
          let user: AuthUserRow;
          try {
            user = await scope.stores.createUser({
              email,
              id: crypto.randomUUID(),
              metadata: withPasswordHash({}, hash),
              name,
              username,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw AthenaAuthRuntimeError.conflict(
                "A user with this email already exists"
              );
            }
            throw error;
          }
          await scope.stores.createAccount({
            accountId: user.id,
            id: crypto.randomUUID(),
            password: hash,
            providerId: ATHENA_AUTH_CREDENTIAL_PROVIDER_ID,
            userId: user.id,
          });
          if (!config.emailAndPassword.autoSignIn) {
            return { session: undefined, user };
          }
          const session = await issueSession(
            request,
            scope.stores,
            user.id,
            headers,
            { methods: ["password"] }
          );
          const refreshed = (await scope.stores.getUserById(user.id)) ?? user;
          return { session, user: refreshed };
        },
        input: { email, name, username },
        resultOf: ({ user }) => ({ user: sanitizeHookUser(user) }),
        secondaryEvents: ({ session }) =>
          session
            ? [
                {
                  event: "session.issue" as const,
                  input: { userId: session.user_id },
                  result: { session: sanitizeHookSession(session) },
                },
              ]
            : [],
      });
      await emitIfRecipient(created.user.email, {
        data: {
          user_name: created.user.name ?? created.user.email ?? created.user.id,
        },
        eventType: authEmailEvents.user.signUp.welcome,
      });
      if (!created.session) {
        return jsonResponse(
          200,
          { session: null, token: null, user: toPublicUser(created.user) },
          headers
        );
      }
      return jsonResponse(
        200,
        {
          session: toPublicSession(created.session),
          token: created.session.token,
          user: toPublicUser(created.user),
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
          : await currentStores.getUserByEmail(
              requireStringField(body, "email")
            );
      const loginEmail =
        user?.email ??
        (path === "/sign-in/email" ? asStringField(body, "email") : undefined);
      await requireIdentityConnectionForEmail(currentStores, loginEmail);
      if (!user) {
        throw AthenaAuthRuntimeError.invalidCredentials();
      }
      if (user.banned && !isUserEffectivelyBanned(user)) {
        await currentStores.updateUser(user.id, {
          banExpires: null,
          banned: false,
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
          (account) =>
            account.provider_id === ATHENA_AUTH_CREDENTIAL_PROVIDER_ID
        )?.password;
      if (!(storedHash && (await hasher.verify(password, storedHash)))) {
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
      const session = await mutate({
        context: {
          actor: { kind: "user", userId: user.id },
          request: hookRequest(request, path),
          traceId,
        },
        event: "session.issue",
        execute: (scope) =>
          issueSession(request, scope.stores, user.id, headers, {
            methods: ["password"],
          }),
        input: { userId: user.id },
        resultOf: (issued) => ({ session: sanitizeHookSession(issued) }),
      });
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
        const existing = await currentStores.getSessionByToken(token);
        if (existing) {
          await mutate({
            context: {
              actor: {
                kind: "user",
                sessionId: existing.id,
                userId: existing.user_id,
              },
              request: hookRequest(request, path),
              traceId,
            },
            event: "session.revoke",
            execute: async (scope) => {
              await revokeAuthBridgeCodesForSessions(
                deps.getBridgeCodeStore(),
                [existing.id]
              );
              await scope.stores.deleteSession(token);
            },
            input: { scope: "one", userId: existing.user_id },
            previous: async () => ({
              session: sanitizeHookSession(existing),
            }),
            resultOf: () => ({
              id: existing.id,
              revoked: true as const,
              userId: existing.user_id,
            }),
          });
        }
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

    if (path === "/send-sign-in-email" && method === "POST") {
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const email = requireStringField(body, "email");
      const user = await currentStores.getUserByEmail(email);
      if (user?.email) {
        const token = Buffer.from(
          crypto.getRandomValues(new Uint8Array(32))
        ).toString("base64url");
        await mutate({
          context: {
            actor: { kind: "user", userId: user.id },
            request: hookRequest(request, path),
            traceId,
          },
          event: "user.sign-in.email",
          execute: async (scope) => {
            await scope.stores.createVerification({
              expiresAt: new Date(Date.now() + 15 * 60 * 1000),
              id: crypto.randomUUID(),
              identifier: `magic:${user.email ?? email}`,
              value: token,
            });
            return { email: user.email ?? email };
          },
          input: { email },
          resultOf: (result) => result,
        });
        const origin = new URL(request.url).origin;
        const redirectTo = asStringField(body, "callbackURL");
        const signInUrl = tokenizedUrl(
          redirectTo,
          token,
          origin,
          "/sign-in/magic",
          config.security.trustedOrigins
        );
        await emitMail({
          data: { sign_in_url: signInUrl },
          eventType: authEmailEvents.user.signIn.email,
          recipient: user.email,
        });
      }
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/send-security-alert" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const alertTitle = requireStringField(body, "alert_title");
      const alertDetails = requireStringField(body, "alert_details");
      const email = asStringField(body, "email") ?? resolved.user.email;
      if (!email) {
        throw AthenaAuthRuntimeError.badRequest("email is required");
      }
      if (email !== resolved.user.email && resolved.user.role !== "admin") {
        throw AthenaAuthRuntimeError.forbidden();
      }
      await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "user.security.alert",
        execute: async () => ({ email }),
        input: { alertDetails, alertTitle, email },
        resultOf: (result) => result,
      });
      await emitMail({
        data: {
          alert_details: alertDetails,
          alert_title: alertTitle,
        },
        eventType: authEmailEvents.user.security.alert,
        recipient: email,
      });
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
      if (!(storedHash && (await hasher.verify(currentPassword, storedHash)))) {
        throw AthenaAuthRuntimeError.invalidCredentials();
      }
      const hash = await hasher.hash(newPassword);
      await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "user.password.change",
        execute: async (scope) => {
          await scope.stores.updateUser(resolved.user.id, {
            metadata: withPasswordHash(
              typeof resolved.user.metadata === "object"
                ? resolved.user.metadata
                : {},
              hash
            ),
          });
          if (body.revokeOtherSessions) {
            const others = (
              await scope.stores.listUserSessions(resolved.user.id)
            ).filter((session) => session.token !== resolved.token);
            await revokeAuthBridgeCodesForSessions(
              deps.getBridgeCodeStore(),
              others.map((session) => session.id)
            );
            await scope.stores.deleteUserSessions(
              resolved.user.id,
              resolved.token
            );
          }
        },
        input: { userId: resolved.user.id },
        resultOf: () => ({ userId: resolved.user.id }),
      });
      await emitIfRecipient(resolved.user.email, {
        data: {},
        eventType: authEmailEvents.user.password.changed,
      });
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
      await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "user.password.change",
        execute: async (scope) => {
          await scope.stores.updateUser(resolved.user.id, {
            metadata: withPasswordHash(
              typeof resolved.user.metadata === "object"
                ? resolved.user.metadata
                : {},
              hash
            ),
          });
        },
        input: { userId: resolved.user.id },
        resultOf: () => ({ userId: resolved.user.id }),
      });
      await emitIfRecipient(resolved.user.email, {
        data: {},
        eventType: authEmailEvents.user.password.changed,
      });
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/update-user" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const image = asStringField(body, "image") ?? undefined;
      const name = asStringField(body, "name");
      const updated = await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "user.update",
        execute: (scope) =>
          scope.stores.updateUser(resolved.user.id, { image, name }),
        input: { image, name, userId: resolved.user.id },
        previous: async () => ({ user: sanitizeHookUser(resolved.user) }),
        resultOf: (user) => ({ user: sanitizeHookUser(user) }),
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
      if (target) {
        await mutate({
          context: {
            actor: {
              kind: "user",
              sessionId: resolved.session.id,
              userId: resolved.user.id,
            },
            request: hookRequest(request, path),
            traceId,
          },
          event: "session.revoke",
          execute: async (scope) => {
            await revokeAuthBridgeCodesForSessions(deps.getBridgeCodeStore(), [
              target.id,
            ]);
            await scope.stores.deleteSession(token);
          },
          input: { scope: "one", userId: resolved.user.id },
          previous: async () => ({
            session: sanitizeHookSession(target),
          }),
          resultOf: () => ({
            id: target.id,
            revoked: true as const,
            userId: target.user_id,
          }),
        });
      }
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/revoke-sessions" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "session.revoke",
        execute: async (scope) => {
          const live = await scope.stores.listUserSessions(resolved.user.id);
          await revokeAuthBridgeCodesForSessions(
            deps.getBridgeCodeStore(),
            live.map((session) => session.id)
          );
          await scope.stores.deleteUserSessions(resolved.user.id);
          return splitPrimaryAndRest(
            live.map((session) => sanitizeHookSession(session))
          );
        },
        input: { scope: "all", userId: resolved.user.id },
        previous: async () => ({
          session: sanitizeHookSession(resolved.session),
        }),
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        previousOf: (partitioned: any) =>
          partitioned
            ? { session: partitioned.primary }
            : { session: sanitizeHookSession(resolved.session) },
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        resultOf: (partitioned: any) => {
          const primary =
            partitioned?.primary ?? sanitizeHookSession(resolved.session);
          return {
            id: primary.id,
            revoked: true as const,
            userId: primary.userId,
          };
        },
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        secondaryEvents: (partitioned: any) =>
          (partitioned?.rest ?? []).map(
            (session: { id: string; userId: string }) => ({
              event: "session.revoke" as const,
              input: { scope: "all" as const, userId: resolved.user.id },
              previous: { session },
              result: {
                id: session.id,
                revoked: true as const,
                userId: session.userId,
              },
            })
          ),
        shouldPersistAudit: (partitioned) => partitioned !== undefined,
      });
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
      await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "session.revoke",
        execute: async (scope) => {
          const live = (
            await scope.stores.listUserSessions(resolved.user.id)
          ).filter((session) => session.token !== resolved.token);
          await revokeAuthBridgeCodesForSessions(
            deps.getBridgeCodeStore(),
            live.map((session) => session.id)
          );
          await scope.stores.deleteUserSessions(
            resolved.user.id,
            resolved.token
          );
          return splitPrimaryAndRest(
            live.map((session) => sanitizeHookSession(session))
          );
        },
        input: { scope: "others", userId: resolved.user.id },
        previous: async () => ({
          session: sanitizeHookSession(resolved.session),
        }),
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        previousOf: (partitioned: any) =>
          partitioned
            ? { session: partitioned.primary }
            : { session: sanitizeHookSession(resolved.session) },
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        resultOf: (partitioned: any) => {
          const primary =
            partitioned?.primary ?? sanitizeHookSession(resolved.session);
          return {
            id: primary.id,
            revoked: true as const,
            userId: primary.userId,
          };
        },
        // biome-ignore lint/suspicious/noExplicitAny: revoke partition from splitPrimaryAndRest
        secondaryEvents: (partitioned: any) =>
          (partitioned?.rest ?? []).map(
            (session: { id: string; userId: string }) => ({
              event: "session.revoke" as const,
              input: { scope: "others" as const, userId: resolved.user.id },
              previous: { session },
              result: {
                id: session.id,
                revoked: true as const,
                userId: session.userId,
              },
            })
          ),
        shouldPersistAudit: (partitioned) => partitioned !== undefined,
      });
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
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "");
      const created = await mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.create",
        execute: async (scope) => {
          let organization: AuthOrganizationRow;
          try {
            organization = await scope.stores.createOrganization({
              createdByUserId: resolved.user.id,
              id: crypto.randomUUID(),
              name,
              slug,
            });
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw AthenaAuthRuntimeError.conflict(
                "Organization slug already exists"
              );
            }
            throw error;
          }
          const member = await scope.stores.addMember({
            id: crypto.randomUUID(),
            organizationId: organization.id,
            role: "owner",
            userId: resolved.user.id,
          });
          await scope.stores.setSessionActiveOrganization(
            resolved.token,
            organization.id
          );
          return { member, organization };
        },
        input: { name, slug },
        resultOf: ({ member, organization }) => ({
          member: sanitizeHookMember(member),
          organization: sanitizeHookOrganization(organization),
        }),
      });
      await emitIfRecipient(resolved.user.email, {
        data: { organization_name: created.organization.name },
        eventType: authEmailEvents.organization.created,
      });
      return jsonResponse(
        200,
        { organization: toPublicOrganization(created.organization) },
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
      const member = await timeAuthSpan("authz", () =>
        currentStores.getMember(organizationId, resolved.user.id)
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const [organization, members] = await Promise.all([
        timeAuthSpan("org_lookup", () =>
          currentStores.getOrganization(organizationId)
        ),
        currentStores.listMembers(organizationId),
      ]);
      if (!organization) {
        throw AthenaAuthRuntimeError.notFound("Organization not found");
      }
      return jsonResponse(
        200,
        {
          ...toPublicOrganization(organization),
          members: await toPublicMembersWithUsers(members, (id) =>
            currentStores.getUserById(id)
          ),
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
      await requireOrgMemberManager(
        currentStores,
        resolved.user.id,
        organizationId,
        member
      );
      const name = asDataEnvelopeStringField(body, "name");
      const slug = asDataEnvelopeStringField(body, "slug");
      const rawLogo =
        asDataEnvelopeStringField(body, "logo") ??
        asDataEnvelopeStringField(body, "image");
      const logo =
        rawLogo === undefined ? undefined : rawLogo === "" ? null : rawLogo;
      const organization = await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.update",
        execute: (scope) =>
          scope.stores.updateOrganization(organizationId, {
            logo,
            name,
            slug,
          }),
        input: {
          logo,
          name,
          organizationId,
          slug,
        },
        previous: async () => {
          const existing = await currentStores.getOrganization(organizationId);
          if (!existing) {
            throw AthenaAuthRuntimeError.notFound("Organization not found");
          }
          return { organization: sanitizeHookOrganization(existing) };
        },
        resultOf: (row) => ({
          organization: sanitizeHookOrganization(row),
        }),
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
      await requireOrgDelete(
        currentStores,
        resolved.user.id,
        organizationId,
        member
      );
      await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.delete",
        execute: async (scope) => {
          await scope.stores.clearOrganizationActiveSessions(organizationId);
          await scope.stores.deleteOrganization(organizationId);
        },
        input: { organizationId },
        previous: async () => {
          const existing = await currentStores.getOrganization(organizationId);
          if (!existing) {
            throw AthenaAuthRuntimeError.notFound("Organization not found");
          }
          return { organization: sanitizeHookOrganization(existing) };
        },
        resultOf: () => ({
          deleted: true as const,
          id: organizationId,
        }),
      });
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/set-active" && method === "POST") {
      const resolved = await requireSession(request, currentStores);
      const body = await readJsonBody(request, config.security.bodyLimitBytes);
      const organizationId = asStringField(body, "organizationId") ?? null;
      if (
        organizationId === (resolved.session.active_organization_id ?? null)
      ) {
        return jsonResponse(200, { status: true }, headers);
      }
      if (organizationId) {
        const member = await currentStores.getMember(
          organizationId,
          resolved.user.id
        );
        if (!member) {
          throw AthenaAuthRuntimeError.forbidden();
        }
      }
      await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId: organizationId ?? undefined,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "session.activeOrganization.update",
        execute: async (scope) => {
          await scope.stores.setSessionActiveOrganization(
            resolved.token,
            organizationId
          );
        },
        input: { organizationId },
        previous: async () => ({
          organizationId: resolved.session.active_organization_id,
        }),
        resultOf: () => ({ organizationId }),
      });
      return jsonResponse(200, { status: true }, headers);
    }

    if (path === "/organization/list-members" && method === "GET") {
      const apiKeyUser = await resolveApiKeyUser(request, currentStores);
      const requestedOrganizationId = new URL(request.url).searchParams.get(
        "organizationId"
      );
      let actorUser: AuthUserRow;
      let organizationId: string | null;
      if (apiKeyUser) {
        actorUser = apiKeyUser.user;
        const keyOrganizationId = apiKeyUser.key.organization_id;
        if (!keyOrganizationId) {
          throw AthenaAuthRuntimeError.forbidden();
        }
        organizationId = requestedOrganizationId ?? keyOrganizationId;
        if (
          apiKeyScopeKind(apiKeyUser.key) !== "organization" ||
          keyOrganizationId !== organizationId
        ) {
          throw AthenaAuthRuntimeError.forbidden();
        }
      } else {
        const resolved = await requireSession(request, currentStores);
        actorUser = resolved.user;
        organizationId =
          requestedOrganizationId ?? resolved.session.active_organization_id;
      }
      if (!organizationId) {
        throw AthenaAuthRuntimeError.badRequest("organizationId is required");
      }
      if (apiKeyUser) {
        const ownerAuthorization = await buildSnapshot(currentStores, {
          session: { active_organization_id: organizationId },
          user: actorUser,
        });
        const authorization = bindApiKeyAuthorization(
          ownerAuthorization,
          apiKeyUser.permissions,
          "organization"
        );
        if (
          missingRequiredRights(authorization.effectiveRights, [
            ORGANIZATION_MEMBERS_READ,
          ]).length > 0
        ) {
          throw AthenaAuthRuntimeError.forbidden();
        }
      }
      const member = await timeAuthSpan("authz", () =>
        currentStores.getMember(organizationId, actorUser.id)
      );
      if (!member) {
        throw AthenaAuthRuntimeError.forbidden();
      }
      const members = await currentStores.listMembers(organizationId);
      const organization = await currentStores.getOrganization(organizationId);
      const foundingOwnerUserId = resolveFoundingOwnerUserId(
        organization,
        members
      );
      const annotated = await Promise.all(
        members.map(async (row) => {
          const actions = await currentStores.authorization.annotateMember(
            row,
            {
              foundingOwnerUserId,
              getMember: (orgId, userId) =>
                currentStores.getMember(orgId, userId),
              userId: actorUser.id,
            }
          );
          const user = await currentStores.getUserById(row.user_id);
          return toPublicMember(row, user, actions);
        })
      );
      return jsonResponse(
        200,
        {
          members: annotated,
        },
        headers
      );
    }

    if (path === "/organization/add-member" && method === "POST") {
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
      await requireOrgMemberManager(
        currentStores,
        resolved.user.id,
        organizationId,
        actor
      );
      const userId = requireStringField(body, "userId");
      const requestedRole = asStringField(body, "role") ?? "member";
      const granted = await requireOrganizationRoleGrant(
        currentStores,
        resolved.user.id,
        organizationId,
        actor,
        requestedRole,
        { role: "member", userId }
      );
      const role = granted.persistedRole;
      if (await currentStores.getMember(organizationId, userId)) {
        throw AthenaAuthRuntimeError.conflict("Member already exists");
      }
      const addedUser = await currentStores.getUserById(userId);
      if (!addedUser) {
        throw AthenaAuthRuntimeError.notFound("User not found");
      }
      const member = await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.member.add",
        execute: (scope) =>
          scope.stores.addMember({
            assignedBy: resolved.user.id,
            id: crypto.randomUUID(),
            organizationId,
            role,
            userId,
          }),
        input: { organizationId, role, userId },
        resultOf: (row) => ({ member: sanitizeHookMember(row) }),
      });
      const addedOrg = await currentStores.getOrganization(organizationId);
      await emitIfRecipient(addedUser.email, {
        data: {
          actor_identity: identityOf(resolved.user),
          member_identity: identityOf(addedUser),
          organization_name: addedOrg?.name ?? "organization",
        },
        eventType: authEmailEvents.organization.member.added,
      });
      return jsonResponse(
        200,
        { member: toPublicMember(member, addedUser) },
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
      await requireOrgMemberManager(
        currentStores,
        resolved.user.id,
        organizationId,
        actor
      );
      const members = await currentStores.listMembers(organizationId);
      const target =
        members.find((item) => item.id === memberIdOrUserId) ??
        members.find((item) => item.user_id === memberIdOrUserId);
      if (!target) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      const organization = await currentStores.getOrganization(organizationId);
      assertFoundingOwnerMutationAllowed({
        kind: "remove",
        members,
        organization,
        targetUserId: target.user_id,
      });
      assertLastOwnerMutationAllowed({
        kind: "remove",
        members,
        targetUserId: target.user_id,
      });
      await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.member.remove",
        execute: async (scope) => {
          await scope.stores.removeMember(organizationId, target.user_id);
          await scope.stores.clearUserActiveOrganization(
            target.user_id,
            organizationId
          );
        },
        input: { organizationId, userId: target.user_id },
        previous: async () => ({ member: sanitizeHookMember(target) }),
        resultOf: () => ({
          deleted: true as const,
          id: target.id,
          organizationId,
          userId: target.user_id,
        }),
      });
      const removedUser = await currentStores.getUserById(target.user_id);
      const removedOrg = await currentStores.getOrganization(organizationId);
      await emitIfRecipient(removedUser?.email, {
        data: {
          actor_identity: identityOf(resolved.user),
          member_identity: identityOf(removedUser ?? { id: target.user_id }),
          organization_name: removedOrg?.name ?? "organization",
        },
        eventType: authEmailEvents.organization.member.removed,
      });
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
      await requireOrgMemberManager(
        currentStores,
        resolved.user.id,
        organizationId,
        actor
      );
      const members = await currentStores.listMembers(organizationId);
      const target =
        members.find((item) => item.id === memberId) ??
        members.find((item) => item.user_id === memberId);
      if (!target) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      const organization = await currentStores.getOrganization(organizationId);
      const granted = await requireOrganizationRoleGrant(
        currentStores,
        resolved.user.id,
        organizationId,
        actor,
        role,
        { role: target.role, userId: target.user_id }
      );
      assertFoundingOwnerMutationAllowed({
        kind: "role",
        members,
        nextRole: granted.persistedRole,
        organization,
        targetUserId: target.user_id,
      });
      assertLastOwnerMutationAllowed({
        kind: "role",
        members,
        nextRole: granted.persistedRole,
        targetUserId: target.user_id,
      });
      const updated = await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.member.role.update",
        execute: async (scope) => {
          const next = await scope.stores.updateMemberRole(
            organizationId,
            target.user_id,
            granted.persistedRole
          );
          return next ?? target;
        },
        input: {
          memberId: target.id,
          organizationId,
          role: granted.persistedRole,
        },
        previous: async () => ({ role: target.role }),
        resultOf: (member) => ({ member: sanitizeHookMember(member) }),
      });
      const roleUser = await currentStores.getUserById(target.user_id);
      const roleOrg = await currentStores.getOrganization(organizationId);
      await emitIfRecipient(roleUser?.email, {
        data: {
          actor_identity: identityOf(resolved.user),
          member_identity: identityOf(roleUser ?? { id: target.user_id }),
          new_role: granted.persistedRole,
          organization_name: roleOrg?.name ?? "organization",
          previous_role: target.role,
        },
        eventType: authEmailEvents.organization.member.roleUpdated,
      });
      return jsonResponse(
        200,
        {
          member: await toPublicMemberWithUser(updated, (id) =>
            currentStores.getUserById(id)
          ),
        },
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
      const leaving = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      if (!leaving) {
        throw AthenaAuthRuntimeError.notFound("Member not found");
      }
      const [organization, members] = await Promise.all([
        currentStores.getOrganization(organizationId),
        currentStores.listMembers(organizationId),
      ]);
      assertFoundingOwnerMutationAllowed({
        kind: "leave",
        members,
        organization,
        targetUserId: resolved.user.id,
      });
      assertLastOwnerMutationAllowed({
        kind: "leave",
        members,
        targetUserId: resolved.user.id,
      });
      await mutate({
        context: {
          actor: {
            kind: "user",
            organizationId,
            sessionId: resolved.session.id,
            userId: resolved.user.id,
          },
          request: hookRequest(request, path),
          traceId,
        },
        event: "organization.member.remove",
        execute: async (scope) => {
          await scope.stores.removeMember(organizationId, resolved.user.id);
          await scope.stores.clearUserActiveOrganization(
            resolved.user.id,
            organizationId
          );
        },
        input: { organizationId, userId: resolved.user.id },
        previous: async () => ({ member: sanitizeHookMember(leaving) }),
        resultOf: () => ({
          deleted: true as const,
          id: leaving.id,
          organizationId,
          userId: resolved.user.id,
        }),
      });
      const leftOrg = await currentStores.getOrganization(organizationId);
      await emitIfRecipient(resolved.user.email, {
        data: {
          actor_identity: identityOf(resolved.user),
          member_identity: identityOf(resolved.user),
          organization_name: leftOrg?.name ?? "organization",
        },
        eventType: authEmailEvents.organization.member.removed,
      });
      return jsonResponse(200, { status: true }, headers);
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
        return jsonResponse(
          200,
          { error: "No organization", success: false },
          headers
        );
      }
      const member = await currentStores.getMember(
        organizationId,
        resolved.user.id
      );
      return jsonResponse(
        200,
        { error: member ? undefined : "Forbidden", success: Boolean(member) },
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
      return jsonResponse(
        200,
        {
          member: await toPublicMemberWithUser(member, (id) =>
            currentStores.getUserById(id)
          ),
        },
        headers
      );
    }

    const relatedOrigins = await handleRelatedOriginsRoute(
      request,
      path,
      method,
      {
        headers,
        relyingParty: passkeyRelyingParty,
      }
    );
    if (relatedOrigins) {
      return relatedOrigins;
    }

    const registerOptions = await handleGenerateRegisterOptionsRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        relyingParty: passkeyRelyingParty,
        resolveSession,
        stores: currentStores,
      }
    );
    if (registerOptions) {
      return registerOptions;
    }

    const authenticateOptions = await handleGenerateAuthenticateOptionsRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        relyingParty: passkeyRelyingParty,
        resolveSession,
        stores: currentStores,
      }
    );
    if (authenticateOptions) {
      return authenticateOptions;
    }

    const verifyRegistration = await handleVerifyRegistrationRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        hookRequest,
        issueSession: (authRequest, authStores, userId) =>
          issueSession(authRequest, authStores, userId, headers, {
            methods: ["passkey"],
          }),
        mutate,
        relyingParty: passkeyRelyingParty,
        resolveOnboardingUser:
          passkeyOnboarding && typeof passkeyOnboarding === "object"
            ? passkeyOnboarding.resolveUser
            : undefined,
        resolveSession,
        stores: currentStores,
        traceId,
      }
    );
    if (verifyRegistration) {
      return verifyRegistration;
    }

    const verifyAuthentication = await handleVerifyAuthenticationRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        hookRequest,
        issueSession: (authRequest, stores, userId) =>
          issueSession(authRequest, stores, userId, headers, {
            methods: ["passkey"],
          }),
        mutate,
        relyingParty: passkeyRelyingParty,
        stores: currentStores,
        traceId,
      }
    );
    if (verifyAuthentication) {
      return verifyAuthentication;
    }

    const listPasskeys = await handleListUserPasskeysRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        hookRequest,
        mutate,
        requireSession,
        stores: currentStores,
        traceId,
      }
    );
    if (listPasskeys) {
      return listPasskeys;
    }

    const deletePasskey = await handleDeletePasskeyRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        hookRequest,
        mutate,
        requireSession,
        stores: currentStores,
        traceId,
      }
    );
    if (deletePasskey) {
      return deletePasskey;
    }

    const updatePasskey = await handleUpdatePasskeyRoute(
      request,
      path,
      method,
      {
        config,
        headers,
        hookRequest,
        mutate,
        requireSession,
        stores: currentStores,
        traceId,
      }
    );
    if (updatePasskey) {
      return updatePasskey;
    }

    const userMail = await handleUserMailRoutes(request, path, method, {
      emailStore,
      headers,
      hookRequest,
      mutate,
      requireSession,
      stores: currentStores,
      traceId,
    });
    if (userMail) {
      return userMail;
    }

    const emailAdmin = await handleAdminEmailRoutes(request, path, method, {
      delivery,
      emailStore,
      headers,
      requireSession,
      stores: currentStores,
    });
    if (emailAdmin) {
      return emailAdmin;
    }

    const authenticationPostureResponse =
      await handleOrganizationAuthenticationPostureRoute(
        request,
        path,
        method,
        currentStores,
        headers,
        requireSession,
        resolveApiKeyUser
      );
    if (authenticationPostureResponse) {
      return authenticationPostureResponse;
    }

    const lifecycleEventResponse = await handleOrganizationLifecycleEventRoute(
      request,
      path,
      method,
      currentStores,
      headers,
      requireSession,
      resolveApiKeyUser,
      deps.listOrganizationLifecycleAuditRows
    );
    if (lifecycleEventResponse) {
      return lifecycleEventResponse;
    }

    const authorizationResponse = await handleAuthorizationRoute(
      request,
      path,
      method,
      currentStores,
      headers,
      requireSession,
      config.security.bodyLimitBytes,
      resolveApiKeyUser,
      mutate
    );
    if (authorizationResponse) {
      return authorizationResponse;
    }

    const adminStore = database
      ? new PostgresAdminAuthStore(database)
      : currentStores instanceof MemoryAuthStores
        ? new MemoryAdminAuthStore(currentStores)
        : undefined;
    if (adminStore && path.startsWith("/admin/")) {
      const identityConnectionResponse =
        await handleIdentityConnectionAdminRoute(
          request,
          path,
          method,
          deps,
          currentStores,
          headers
        );
      if (identityConnectionResponse) {
        return identityConnectionResponse;
      }
      const adminResponse = await handleAdminRoute(request, path, method, {
        config,
        hasher,
        headers,
        hookRequest,
        issueSession: (adminRequest, stores, userId, authentication) =>
          issueSession(adminRequest, stores, userId, headers, authentication),
        listSessionsForUser: (userId) => currentStores.listUserSessions(userId),
        mutate,
        requireSession: (adminRequest) =>
          requireSession(adminRequest, currentStores),
        revokeBridgeCodesForUser: async (userId, exceptToken) => {
          const sessions = await currentStores.listUserSessions(userId);
          await revokeAuthBridgeCodesForSessions(
            deps.getBridgeCodeStore(),
            sessions
              .filter(
                (session) => !exceptToken || session.token !== exceptToken
              )
              .map((session) => session.id)
          );
        },
        store: adminStore,
        traceId,
      });
      if (adminResponse) {
        return adminResponse;
      }
    }

    const extended = await handleExtendedRoute(request, path, method, {
      config,
      emitMail,
      getBridgeCodeStore: deps.getBridgeCodeStore,
      hasher,
      headers,
      hookRequest,
      issueSession,
      mutate,
      otpRateLimiter: deps.otpRateLimiter,
      otpVerificationRateLimiter: deps.otpVerificationRateLimiter,
      requireSession,
      stores: currentStores,
      traceId,
    });
    if (extended) {
      return extended;
    }

    throw AthenaAuthRuntimeError.notFound("Not found");
  };

  const handleRoute = async (
    request: Request,
    path: string,
    currentStores: AthenaAuthStores,
    headers: Headers,
    traceId: string
  ): Promise<Response> => {
    const method = request.method.toUpperCase();
    if (method === "OPTIONS") {
      headers.set(
        "Access-Control-Expose-Headers",
        "Server-Timing, X-Athena-Time, x-athena-trace-id, x-request-id"
      );
      headers.set(
        "Access-Control-Allow-Headers",
        "content-type, authorization, cookie, x-athena-sdk, x-athena-trace-id, x-request-id"
      );
      return new Response(null, { headers, status: 204 });
    }

    const domain = resolveAuthRouteDomain(path);
    if (domain) {
      for (const handler of domains[domain]) {
        const response = await handler(
          request,
          path,
          method,
          currentStores,
          headers,
          traceId
        );
        if (response) {
          return response;
        }
      }
    }

    return handleCore(request, path, currentStores, headers, traceId);
  };

  return { handleRoute, route };
}
