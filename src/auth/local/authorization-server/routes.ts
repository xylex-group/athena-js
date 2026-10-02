import { decodeJwt } from "jose";
import {
  buildAuthorizationServerMetadata,
  type IssuedOAuthTokenSet,
  OAuthProtocolError,
  oauthErrorResponse,
  oauthJsonResponse,
  parseScopes,
  projectOAuthTokenEndpointResponse,
} from "../../authorization-server/index.ts";
import type { OidcPrompt } from "../../authorization-server/types.ts";
import type { OidcIdentityScope } from "../../authorization-server/types.ts";
import { intersectScopes } from "../../authorization-server/scopes.ts";
import { buildOpenIdProviderMetadata } from "../../authorization-server/metadata.ts";
import type { AthenaAuthMutationScope } from "../../hooks/scope.ts";
import { authenticationContextFromSession } from "../authentication-context.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthRuntimeDependencies } from "../runtime-dependencies.ts";
import { projectOidcClaims } from "../../authorization-server/oidc-claims.ts";
import { readFormBody, requestClientIp } from "../security.ts";
import type { OAuthAuthorizationServerService } from "./service.ts";
import { handleAuthorizationServerAdminRoutes } from "./admin-routes.ts";

export interface AuthorizationServerRouteContext {
  deps: AuthRuntimeDependencies;
  headers: Headers;
  stores: AthenaAuthStores;
  traceId: string;
}

function serviceInMutation(
  service: OAuthAuthorizationServerService,
  scope: AthenaAuthMutationScope
): OAuthAuthorizationServerService {
  return service.withMutationScope(scope);
}

function queryValue(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new OAuthProtocolError(
      "invalid_request",
      `OAuth parameter "${key}" must be supplied once.`
    );
  }
  const value = values[0];
  return value?.trim() || undefined;
}

export function queryOpaqueValue(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (values.length > 1) {
    throw new OAuthProtocolError(
      "invalid_request",
      `OAuth parameter "${key}" must be supplied once.`
    );
  }
  return values[0];
}

function requiredQueryValue(url: URL, key: string): string {
  const value = queryValue(url, key);
  if (!value) {
    throw new OAuthProtocolError("invalid_request", `${key} is required.`);
  }
  return value;
}

function oidcRequestParameters(url: URL): {
  maxAge?: number;
  nonce?: string;
  prompt?: OidcPrompt[];
} {
  const maxAgeValue = queryValue(url, "max_age");
  let maxAge: number | undefined;
  if (maxAgeValue !== undefined) {
    if (!/^\d+$/.test(maxAgeValue) || !Number.isSafeInteger(Number(maxAgeValue))) {
      throw new OAuthProtocolError(
        "invalid_request",
        "The max_age value must be a non-negative integer."
      );
    }
    maxAge = Number(maxAgeValue);
  }
  const promptValue = queryValue(url, "prompt");
  const promptValues = promptValue?.split(/\s+/);
  if (
    promptValues?.some(
      (value) => value !== "none" && value !== "login" && value !== "consent"
    )
  ) {
    throw new OAuthProtocolError(
      "invalid_request",
      "The requested prompt value is not supported."
    );
  }
  const prompt = promptValues as OidcPrompt[] | undefined;
  if (prompt && new Set(prompt).size !== prompt.length) {
    throw new OAuthProtocolError(
      "invalid_request",
      "The prompt value must not contain duplicates."
    );
  }
  const nonce = queryOpaqueValue(url, "nonce");
  return {
    ...(maxAge !== undefined ? { maxAge } : {}),
    ...(nonce !== undefined ? { nonce } : {}),
    ...(prompt ? { prompt } : {}),
  };
}

function requiredFormValue(body: Record<string, string>, key: string): string {
  const value = body[key]?.trim();
  if (!value) {
    throw new OAuthProtocolError("invalid_request", `${key} is required.`);
  }
  return value;
}

function needsReauthentication(
  session: { session: { authenticated_at: Date | string } },
  interaction: { createdAt: Date; maxAge: number | null; prompt: readonly OidcPrompt[] },
  now: Date
): boolean {
  const authenticatedAt = new Date(session.session.authenticated_at).getTime();
  if (!Number.isFinite(authenticatedAt) || authenticatedAt > now.getTime()) {
    return true;
  }
  if (interaction.maxAge === 0) {
    return authenticatedAt < interaction.createdAt.getTime();
  }
  return (
    (interaction.prompt.includes("login") &&
      authenticatedAt < interaction.createdAt.getTime()) ||
    (interaction.maxAge !== null &&
      now.getTime() - authenticatedAt > interaction.maxAge * 1000)
  );
}

function signInRedirect(
  signInUrl: string,
  interaction: { id: string },
  forceLogin: boolean
): Response {
  const signIn = new URL(signInUrl);
  signIn.searchParams.set("interaction_id", interaction.id);
  if (forceLogin) {
    signIn.searchParams.set("prompt", "login");
  }
  return Response.redirect(signIn, 302);
}

function oauthRedirect(
  redirectUri: string,
  input: {
    error?: string;
    errorDescription?: string;
    iss: string;
    state?: string;
    code?: string;
  }
): Response {
  const redirect = new URL(redirectUri);
  if (input.code) {
    redirect.searchParams.set("code", input.code);
  }
  if (input.error) {
    redirect.searchParams.set("error", input.error);
  }
  if (input.errorDescription) {
    redirect.searchParams.set("error_description", input.errorDescription);
  }
  if (input.state) {
    redirect.searchParams.set("state", input.state);
  }
  redirect.searchParams.set("iss", input.iss);
  return new Response(null, {
    headers: {
      "cache-control": "no-store",
      location: redirect.toString(),
      pragma: "no-cache",
    },
    status: 302,
  });
}

function isAuthorizationServerPath(path: string): boolean {
  return (
    path === "/oauth/authorize" ||
    path === "/oauth/token" ||
    path === "/userinfo" ||
    path === "/oauth/revoke" ||
    path === "/.well-known/openid-configuration" ||
    path === "/.well-known/oauth-authorization-server" ||
    path === "/authorization/grants" ||
    /^\/authorization\/grants\/[^/]+\/revoke$/.test(path)
  );
}

function invalidUserInfoToken(headers: Headers): Response {
  const response = oauthErrorResponse(
    new OAuthProtocolError("invalid_token", "A valid OIDC access token is required.", {
      status: 401,
    }),
    headers
  );
  response.headers.set("www-authenticate", 'Bearer error="invalid_token"');
  return response;
}

function protocolTokenBody(response: IssuedOAuthTokenSet) {
  return projectOAuthTokenEndpointResponse(response);
}

async function consumeOAuthProtocolRateLimit(input: {
  clientId?: string;
  context: AuthorizationServerRouteContext;
  kind: "authorize" | "revoke" | "token";
  request: Request;
}): Promise<void> {
  const ip = requestClientIp(
    input.request,
    input.context.deps.config.security.trustedProxy
  );
  if (!ip) {
    return;
  }
  const clientKey = input.clientId?.trim() || "unknown";
  const keys = [
    `oauth:${input.kind}:ip:${ip}`,
    `oauth:${input.kind}:client-ip:${clientKey}:${ip}`,
  ];
  for (const key of keys) {
    if (!(await input.context.deps.oauthRateLimiter.consume(key))) {
      throw new OAuthProtocolError(
        "temporarily_unavailable",
        "Too many OAuth requests.",
        { status: 429 }
      );
    }
  }
}

export async function handleAuthorizationServerRoutes(
  request: Request,
  path: string,
  method: string,
  context: AuthorizationServerRouteContext
): Promise<Response | undefined> {
  if (path.startsWith("/admin/authorization-server/")) {
    return handleAuthorizationServerAdminRoutes(request, path, method, context);
  }
  const config = context.deps.config.authorizationServer;
  if (!(config.enabled && isAuthorizationServerPath(path))) {
    return undefined;
  }
  const protocol = await context.deps.getProtocolRuntime();
  const issuer = protocol.identity.issuer;
  const service = protocol.oauth;
  const oauthStores = await context.deps.getOAuthStores();

  if (path === "/authorization/grants" && method === "GET") {
    const session = await context.deps.resolveSession(request, context.stores);
    if (!session) {
      return oauthErrorResponse(
        new OAuthProtocolError(
          "invalid_request",
          "Authentication is required."
        ),
        context.headers
      );
    }
    const grants = await service.listGrants(session.user.id);
    return oauthJsonResponse(
      200,
      grants.map(({ client, grant }) => ({
        authorizedAt: grant.authorizedAt.toISOString(),
        client: client
          ? { id: client.id, name: client.clientName }
          : { id: grant.clientId, name: "Unknown client" },
        id: grant.id,
        lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
        organizationId: grant.organizationId,
        resource: grant.resource,
        scopes: grant.scopes,
        status: grant.status,
      })),
      context.headers
    );
  }

  const grantRevoke = path.match(/^\/authorization\/grants\/([^/]+)\/revoke$/);
  if (grantRevoke && method === "POST") {
    const session = await context.deps.resolveSession(request, context.stores);
    if (!session) {
      return oauthErrorResponse(
        new OAuthProtocolError(
          "invalid_request",
          "Authentication is required."
        ),
        context.headers
      );
    }
    await context.deps.mutate({
      context: {
        actor: {
          kind: "user",
          sessionId: session.session.id,
          userId: session.user.id,
        },
        request: context.deps.hookRequest(request, path),
        traceId: context.traceId,
      },
      event: "oauth.grant.revoked",
      execute: async (scope) =>
        serviceInMutation(service, scope).revokeGrant({
          grantId: decodeURIComponent(grantRevoke[1] as string),
          userId: session.user.id,
        }),
      input: {
        grantId: decodeURIComponent(grantRevoke[1] as string),
        userId: session.user.id,
      },
      resultOf: () => ({
        deleted: true as const,
        id: decodeURIComponent(grantRevoke[1] as string),
        userId: session.user.id,
      }),
    });
    return oauthJsonResponse(200, { revoked: true }, context.headers);
  }

  if (path === "/.well-known/oauth-authorization-server" && method === "GET") {
    return oauthJsonResponse(
      200,
      buildAuthorizationServerMetadata({
        config,
        identity: protocol.identity,
      }),
      context.headers
    );
  }

  if (path === "/.well-known/openid-configuration" && method === "GET") {
    return oauthJsonResponse(
      200,
      buildOpenIdProviderMetadata({ config, identity: protocol.identity }),
      context.headers
    );
  }

  if (path === "/userinfo" && (method === "GET" || method === "POST")) {
    const authorization = request.headers.get("authorization") ?? "";
    const bearer = /^Bearer\s+(.+)$/i.exec(authorization)?.[1];
    if (!bearer) {
      return invalidUserInfoToken(context.headers);
    }
    try {
      const audience = decodeJwt(bearer).aud;
      if (
        typeof audience !== "string" ||
        (!Object.hasOwn(config.resources, audience) &&
          audience !== protocol.identity.userInfoEndpoint)
      ) {
        return invalidUserInfoToken(context.headers);
      }
      const verifier = await context.deps.getOAuthRuntimeJwtVerifier(audience);
      const resolved = await verifier({
        headers: request.headers,
        request,
      });
      const principal = resolved?.principal;
      const oauth = principal?.oauth;
      if (
        !principal ||
        typeof principal.userId !== "string" ||
        !oauth
      ) {
        return invalidUserInfoToken(context.headers);
      }
      const grant = await oauthStores.grants.get(oauth.grantId);
      const identityScopes = intersectScopes(
        oauth.identityScopes ?? [],
        grant?.identityScopes ?? []
      ) as OidcIdentityScope[];
      if (!grant || !identityScopes.includes("openid")) {
        return invalidUserInfoToken(context.headers);
      }
      const user = await context.stores.getUserById(principal.userId);
      if (!user) {
        return invalidUserInfoToken(context.headers);
      }
      const claims = projectOidcClaims({
        identityScopes,
        user,
      });
      return oauthJsonResponse(200, claims, context.headers);
    } catch {
      return invalidUserInfoToken(context.headers);
    }
  }

  if (path === "/oauth/token" && method === "POST") {
    try {
      const body = await readFormBody(
        request,
        context.deps.config.security.bodyLimitBytes
      );
      const grantType = requiredFormValue(body, "grant_type");
      const clientId = requiredFormValue(body, "client_id");
      await consumeOAuthProtocolRateLimit({
        clientId,
        context,
        kind: "token",
        request,
      });
      if (grantType === "authorization_code") {
        const response = await context.deps.transaction(async (scope) =>
          serviceInMutation(service, scope).exchangeAuthorizationCode({
            clientId,
            code: requiredFormValue(body, "code"),
            codeVerifier: requiredFormValue(body, "code_verifier"),
            redirectUri: requiredFormValue(body, "redirect_uri"),
        resource: body.resource || undefined,
          })
        );
        return oauthJsonResponse(
          200,
          protocolTokenBody(response),
          context.headers
        );
      }
      if (grantType === "refresh_token") {
        const refreshInput = {
          clientId,
          refreshToken: requiredFormValue(body, "refresh_token"),
          resource: requiredFormValue(body, "resource"),
          scope: body.scope,
        };
        const runRefreshMutation = async (
          attempt: number
        ): Promise<Response> => {
          const intent = await service.refreshMutationIntent(refreshInput);
          try {
            if (intent.kind === "rotated") {
              const result = await context.deps.mutate({
                context: {
                  actor: { kind: "system" },
                  request: context.deps.hookRequest(request, path),
                  traceId: context.traceId,
                },
                event: "oauth.refresh.rotated",
                execute: async (scope) =>
                  serviceInMutation(service, scope).refreshMutation(
                    refreshInput,
                    "rotated"
                  ),
                input: intent,
                resultOf: (result) => ({
                  familyId:
                    result.kind === "rotated"
                      ? result.response.familyId
                      : result.familyId,
                }),
              });
              if (result.kind === "reuse_detected") {
                throw new OAuthProtocolError(
                  "invalid_grant",
                  "The refresh token outcome changed during the request.",
                  {
                    cause: {
                      actualKind: "reuse_detected",
                      clientId: result.clientId,
                      event: "oauth.refresh.outcome_mismatch",
                      familyId: result.familyId,
                      grantId: result.grantId,
                    },
                  }
                );
              }
              return oauthJsonResponse(
                200,
                protocolTokenBody(result.response),
                context.headers
              );
            }
            const result = await context.deps.mutate({
              context: {
                actor: { kind: "system" },
                request: context.deps.hookRequest(request, path),
                traceId: context.traceId,
              },
              event: "oauth.refresh.reuse_detected",
              execute: async (scope) =>
                serviceInMutation(service, scope).refreshMutation(
                  refreshInput,
                  "reuse_detected"
                ),
              input: intent,
              resultOf: (value) => ({
                familyId:
                  value.kind === "rotated"
                    ? value.response.familyId
                    : value.familyId,
              }),
            });
            if (result.kind === "rotated") {
              throw new OAuthProtocolError(
                "invalid_grant",
                "The refresh token outcome changed during the request."
              );
            }
            throw new OAuthProtocolError(
              "invalid_grant",
              "The refresh token has been reused.",
              {
                cause: {
                  clientId: result.clientId,
                  event: "oauth.refresh.reuse_detected",
                  familyId: result.familyId,
                  grantId: result.grantId,
                },
              }
            );
          } catch (error) {
            if (
              attempt === 0 &&
              error instanceof OAuthProtocolError &&
              error.cause &&
              typeof error.cause === "object" &&
              (error.cause as Record<string, unknown>).event ===
                "oauth.refresh.outcome_mismatch"
            ) {
              return runRefreshMutation(1);
            }
            throw error;
          }
        };
        return runRefreshMutation(0);
      }
      throw new OAuthProtocolError(
        "unsupported_grant_type",
        "Only authorization_code and refresh_token are supported."
      );
    } catch (error) {
      if (error instanceof OAuthProtocolError) {
        return oauthErrorResponse(error, context.headers);
      }
      return oauthErrorResponse(
        new OAuthProtocolError("server_error", "OAuth token request failed.", {
          cause: error,
          status: 500,
        }),
        context.headers
      );
    }
  }

  if (path === "/oauth/revoke" && method === "POST") {
    try {
      const body = await readFormBody(
        request,
        context.deps.config.security.bodyLimitBytes
      );
      const clientId = requiredFormValue(body, "client_id");
      await consumeOAuthProtocolRateLimit({
        clientId,
        context,
        kind: "revoke",
        request,
      });
      await service.getClient(clientId);
      await context.deps.transaction(async (scope) =>
        serviceInMutation(service, scope).revoke({
          clientId,
          token: requiredFormValue(body, "token"),
          tokenTypeHint:
            body.token_type_hint === "access_token" ||
            body.token_type_hint === "refresh_token"
              ? body.token_type_hint
              : undefined,
        })
      );
      return oauthJsonResponse(200, {}, context.headers);
    } catch {
      return oauthJsonResponse(200, {}, context.headers);
    }
  }

  if (path !== "/oauth/authorize") {
    return undefined;
  }

  if (path === "/oauth/authorize" && method === "GET") {
    const url = new URL(request.url);
    const interactionId = queryValue(url, "interaction_id");
    if (interactionId) {
      const interaction =
        await oauthStores.authorizationRequests.get(interactionId);
      if (!interaction) {
        return oauthErrorResponse(
          new OAuthProtocolError(
            "invalid_request",
            "The authorization interaction is invalid or expired."
          ),
          context.headers
        );
      }
      const session = await context.deps.resolveSession(
        request,
        context.stores
      );
      if (!session) {
        if (interaction.prompt.includes("none")) {
          throw new OAuthProtocolError(
            "login_required",
            "The user is not authenticated."
          );
        }
        if (config.signInUrl) {
          return signInRedirect(config.signInUrl, interaction, true);
        }
        throw new OAuthProtocolError(
          "login_required",
          "Authentication is required to continue authorization."
        );
      }
      if (needsReauthentication(session, interaction, new Date())) {
        if (interaction.prompt.includes("none")) {
          throw new OAuthProtocolError(
            "login_required",
            "The current authentication does not satisfy the request."
          );
        }
        if (config.signInUrl) {
          return signInRedirect(config.signInUrl, interaction, true);
        }
        throw new OAuthProtocolError(
          "login_required",
          "The user must authenticate again."
        );
      }
      if (interaction.prompt.includes("none")) {
        const state = await service.readAuthorizationState(interaction);
        try {
          const approved = await context.deps.mutate({
          context: {
            actor: {
              kind: "user",
              sessionId: session.session.id,
              userId: session.user.id,
            },
            request: context.deps.hookRequest(request, path),
            traceId: context.traceId,
          },
          event: "oauth.grant.authorized",
          execute: async (scope) => {
            const authentication = authenticationContextFromSession(
              session.session
            );
            return serviceInMutation(service, scope).approveAuthorizationRequest({
              authenticatedAt: authentication.authenticatedAt,
              authenticationMethods: authentication.methods,
              id: interaction.id,
              organizationId: session.session.active_organization_id ?? null,
              preserveExistingGrant: true,
              userId: session.user.id,
            });
          },
          input: {
            clientId: interaction.clientId,
            grantId: interaction.id,
            resource: interaction.resource,
            scopes: interaction.requestedScopes,
            userId: session.user.id,
          },
          resultOf: (result) => ({
            grantId: result.grant.id,
            userId: session.user.id,
          }),
          });
          return oauthRedirect(interaction.redirectUri, {
            code: approved.code,
            iss: issuer,
            state,
          });
        } catch (error) {
          if (error instanceof OAuthProtocolError) {
            return oauthRedirect(interaction.redirectUri, {
              error: error.code,
              errorDescription: error.description,
              iss: issuer,
              state,
            });
          }
          throw error;
        }
      }
      if (config.consentUrl) {
        const consent = new URL(config.consentUrl);
        consent.searchParams.set("interaction_id", interaction.id);
        return Response.redirect(consent, 302);
      }
      return oauthJsonResponse(
        200,
        {
          clientId: interaction.clientId,
          interactionId: interaction.id,
          resource: interaction.resource,
          scopes: interaction.requestedScopes,
        },
        context.headers
      );
    }
    const clientId = requiredQueryValue(url, "client_id");
    const redirectUri = requiredQueryValue(url, "redirect_uri");
    const state = requiredQueryValue(url, "state");
    try {
      await consumeOAuthProtocolRateLimit({
        clientId,
        context,
        kind: "authorize",
        request,
      });
      const oidc = oidcRequestParameters(url);
      const interaction = await service.createAuthorizationRequest({
        clientId,
        codeChallenge: requiredQueryValue(url, "code_challenge"),
        codeChallengeMethod: requiredQueryValue(
          url,
          "code_challenge_method"
        ) as "S256",
        ...oidc,
        redirectUri,
        resource: queryValue(url, "resource") ?? undefined,
        scope: queryValue(url, "scope") ?? null,
        state,
      });
      const session = await context.deps.resolveSession(
        request,
        context.stores
      );
      if (!session) {
        if (interaction.prompt.includes("none")) {
          throw new OAuthProtocolError(
            "login_required",
            "The user is not authenticated."
          );
        }
        if (config.signInUrl) {
          return signInRedirect(config.signInUrl, interaction, false);
        }
        throw new OAuthProtocolError(
          "login_required",
          "Authentication is required to authorize this client."
        );
      }
      if (needsReauthentication(session, interaction, new Date())) {
        if (interaction.prompt.includes("none")) {
          throw new OAuthProtocolError(
            "login_required",
            "The current authentication does not satisfy the request."
          );
        }
        if (config.signInUrl) {
          return signInRedirect(config.signInUrl, interaction, true);
        }
        throw new OAuthProtocolError(
          "login_required",
          "The user must authenticate again."
        );
      }
      if (interaction.prompt.includes("none")) {
        const existing = await oauthStores.grants.findActive({
          clientId: interaction.clientId,
          organizationId: session.session.active_organization_id ?? null,
          resource: interaction.resource,
          userId: session.user.id,
        });
        if (
          !existing ||
          interaction.requestedScopes.some(
            (entry) => !existing.scopes.includes(entry)
          ) ||
          interaction.identityScopes.some(
            (entry) => !existing.identityScopes.includes(entry)
          )
        ) {
          throw new OAuthProtocolError(
            "consent_required",
            "The user has not consented to this request."
          );
        }
        const continuation = new URL(request.url);
        continuation.search = new URLSearchParams({
          interaction_id: interaction.id,
        }).toString();
        return Response.redirect(continuation, 302);
      }
      if (config.consentUrl) {
        const consent = new URL(config.consentUrl);
        consent.searchParams.set("interaction_id", interaction.id);
        return Response.redirect(consent, 302);
      }
      return oauthJsonResponse(
        200,
        {
          clientId: interaction.clientId,
          interactionId: interaction.id,
          resource: interaction.resource,
          scopes: interaction.requestedScopes,
        },
        context.headers
      );
    } catch (error) {
      if (error instanceof OAuthProtocolError) {
        if (error.code === "temporarily_unavailable") {
          return oauthErrorResponse(error, context.headers);
        }
        try {
          const client = await service.getClient(clientId);
          const candidate = queryValue(url, "redirect_uri");
          if (candidate) {
            const redirect = new URL(candidate);
            if (client.redirectUris.includes(redirect.toString())) {
              return oauthRedirect(redirect.toString(), {
                error: error.code,
                errorDescription: error.description,
                iss: issuer,
                state,
              });
            }
          }
        } catch {
          // Redirect only after independently validating client and URI.
        }
        return oauthErrorResponse(error, context.headers);
      }
      return oauthErrorResponse(
        new OAuthProtocolError("server_error", "OAuth authorization failed.", {
          cause: error,
          status: 500,
        }),
        context.headers
      );
    }
  }

  if (path === "/oauth/authorize" && method === "POST") {
    try {
      const body = await readFormBody(
        request,
        context.deps.config.security.bodyLimitBytes
      );
      const interactionId = requiredFormValue(body, "interaction_id");
      const session = await context.deps.resolveSession(
        request,
        context.stores
      );
      if (!session) {
        throw new OAuthProtocolError(
          "invalid_request",
          "Authentication is required to continue authorization."
        );
      }
      const interaction =
        await oauthStores.authorizationRequests.get(interactionId);
      if (!interaction) {
        throw new OAuthProtocolError(
          "invalid_request",
          "The authorization interaction is invalid or expired."
        );
      }
      await consumeOAuthProtocolRateLimit({
        clientId: interaction.clientId,
        context,
        kind: "authorize",
        request,
      });
      const state = await service.readAuthorizationState(interaction);
      if (body.decision === "deny") {
        await context.deps.mutate({
          context: {
            actor: {
              kind: "user",
              sessionId: session.session.id,
              userId: session.user.id,
            },
            request: context.deps.hookRequest(request, path),
            traceId: context.traceId,
          },
          event: "oauth.authorization.denied",
          execute: async (scope) =>
            serviceInMutation(service, scope).denyAuthorizationRequest(
              interactionId
            ),
          input: {
            clientId: interaction.clientId,
            requestId: interactionId,
            userId: session.user.id,
          },
          resultOf: (result) => ({
            requestId: result.id,
            userId: session.user.id,
          }),
        });
        return oauthRedirect(interaction.redirectUri, {
          error: "access_denied",
          iss: issuer,
          state,
        });
      }
      if (body.decision !== "approve") {
        throw new OAuthProtocolError(
          "invalid_request",
          "decision must be approve or deny."
        );
      }
      const approvedScopes = body.scope ? parseScopes(body.scope) : undefined;
      if (
        approvedScopes?.some(
          (scope) => !interaction.requestedScopes.includes(scope)
        )
      ) {
        throw new OAuthProtocolError(
          "invalid_scope",
          "Consent cannot widen the requested scope."
        );
      }
      const authentication = authenticationContextFromSession(session.session);
      const approved = await context.deps.mutate({
        context: {
          actor: {
            kind: "user",
            sessionId: session.session.id,
            userId: session.user.id,
          },
          request: context.deps.hookRequest(request, path),
          traceId: context.traceId,
        },
        event: "oauth.grant.authorized",
        execute: async (scope) =>
          serviceInMutation(service, scope).approveAuthorizationRequest({
            authenticatedAt: authentication.authenticatedAt,
            authenticationMethods: authentication.methods,
            id: interactionId,
            organizationId: session.session.active_organization_id ?? null,
            ...(approvedScopes ? { scopes: approvedScopes } : {}),
            userId: session.user.id,
          }),
        input: {
          clientId: interaction.clientId,
          grantId: interaction.id,
          resource: interaction.resource,
          scopes: approvedScopes ?? interaction.requestedScopes,
          userId: session.user.id,
        },
        resultOf: (result) => ({
          grantId: result.grant.id,
          userId: session.user.id,
        }),
      });
      return oauthRedirect(interaction.redirectUri, {
        code: approved.code,
        iss: issuer,
        state,
      });
    } catch (error) {
      if (error instanceof OAuthProtocolError) {
        return oauthErrorResponse(error, context.headers);
      }
      return oauthErrorResponse(
        new OAuthProtocolError("server_error", "OAuth authorization failed.", {
          cause: error,
          status: 500,
        }),
        context.headers
      );
    }
  }

  return undefined;
}

export async function disableAuthorizationServerClient(
  context: AuthorizationServerRouteContext,
  clientId: string
): Promise<void> {
  const protocol = await context.deps.getProtocolRuntime();
  const service = protocol.oauth;
  await context.deps.mutate({
    context: {
      actor: { kind: "system" },
      request: { method: "POST", path: "/oauth/clients/disable" },
      traceId: context.traceId,
    },
    event: "oauth.client.disabled",
    execute: async (scope) =>
      serviceInMutation(service, scope).disableClient(clientId),
    input: { clientId },
    resultOf: () => ({ clientId }),
  });
}
