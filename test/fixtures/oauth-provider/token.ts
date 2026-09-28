import { SignJWT } from "jose";
import type { OAuthFixtureKeys } from "./jwks.ts";
import { oauthS256Challenge } from "./pkce.ts";
import type {
  OAuthFixtureConfig,
  OAuthFixtureStore,
  OAuthIssuedToken,
} from "./types.ts";

async function readForm(request: Request): Promise<URLSearchParams> {
  const text = await request.text();
  return new URLSearchParams(text);
}

function jsonError(error: string, status = 400): Response {
  return Response.json({ error }, { status });
}

async function mintIdToken(
  keys: OAuthFixtureKeys,
  input: {
    audience: string;
    expiresAt: number;
    issuer: string;
    nonce?: string;
    subject: string;
  }
): Promise<string> {
  return new SignJWT({
    email: `${input.subject}@oauth.test`,
    email_verified: true,
    name: input.subject,
    nonce: input.nonce,
  })
    .setProtectedHeader({ alg: "RS256", kid: "oauth-fixture" })
    .setAudience(input.audience)
    .setExpirationTime(Math.floor(input.expiresAt / 1000))
    .setIssuedAt()
    .setIssuer(input.issuer)
    .setSubject(input.subject)
    .sign(keys.privateKey);
}

export async function handleToken(
  request: Request,
  store: OAuthFixtureStore,
  config: OAuthFixtureConfig,
  keys: OAuthFixtureKeys
): Promise<Response> {
  const form = await readForm(request);
  const grant = form.get("grant_type") ?? "";
  const clientId = form.get("client_id") ?? "";
  const clientSecret = form.get("client_secret") ?? "";
  const knownSecret =
    clientId === config.secondClientId
      ? config.secondClientSecret
      : config.clientSecret;
  if (clientId !== config.clientId && clientId !== config.secondClientId) {
    return jsonError("invalid_client", 401);
  }
  if (clientSecret !== knownSecret) {
    return jsonError("invalid_client", 401);
  }
  if (grant === "refresh_token") {
    const refresh = form.get("refresh_token") ?? "";
    const previous = store.refreshTokens.get(refresh);
    if (!previous) {
      return jsonError("invalid_grant");
    }
    const next = await mintAccess(store, keys, config, {
      ...previous,
      expiresAt: Date.now() + 3_600_000,
    });
    return Response.json({
      access_token: next.accessToken,
      expires_in: 3600,
      id_token: next.idToken,
      refresh_token: next.refreshToken,
      token_type: "Bearer",
    });
  }
  if (grant !== "authorization_code") {
    return jsonError("unsupported_grant_type");
  }
  const code = form.get("code") ?? "";
  if (code === "invalid") {
    return jsonError("invalid_grant");
  }
  const issued = store.codes.get(code);
  if (!issued) {
    return jsonError("invalid_grant");
  }
  store.codes.delete(code);
  if (issued.clientId !== clientId) {
    return jsonError("invalid_grant");
  }
  const redirectUri = form.get("redirect_uri") ?? "";
  if (redirectUri !== issued.redirectUri) {
    return jsonError("invalid_grant");
  }
  const verifier = form.get("code_verifier") ?? "";
  if (issued.challenge && oauthS256Challenge(verifier) !== issued.challenge) {
    return jsonError("invalid_grant");
  }
  const expiresAt =
    issued.scenario === "expired-token"
      ? Date.now() - 1000
      : Date.now() + 3_600_000;
  const issuer =
    issued.scenario === "issuer-mismatch"
      ? "https://evil.issuer.test"
      : config.issuer;
  const token = await mintAccess(store, keys, config, {
    accessToken: `access_${crypto.randomUUID()}`,
    clientId,
    expiresAt,
    scenario: issued.scenario,
    subject: issued.subject,
  });
  token.idToken = await mintIdToken(keys, {
    audience: clientId,
    expiresAt,
    issuer,
    nonce: issued.scenario === "wrong-nonce" ? "not-the-nonce" : issued.nonce,
    subject: issued.subject,
  });
  return Response.json({
    access_token: token.accessToken,
    expires_in: Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)),
    id_token: token.idToken,
    refresh_token: token.refreshToken,
    token_type: "Bearer",
  });
}

async function mintAccess(
  store: OAuthFixtureStore,
  _keys: OAuthFixtureKeys,
  _config: OAuthFixtureConfig,
  partial: Omit<OAuthIssuedToken, "refreshToken"> & { refreshToken?: string }
): Promise<OAuthIssuedToken> {
  const refreshToken = partial.refreshToken ?? `refresh_${crypto.randomUUID()}`;
  const token: OAuthIssuedToken = {
    ...partial,
    refreshToken,
  };
  store.tokens.set(token.accessToken, token);
  store.refreshTokens.set(refreshToken, token);
  return token;
}
