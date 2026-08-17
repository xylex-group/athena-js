import type { OAuth2Tokens } from "./types.ts";

/**
 * Normalize a provider token-endpoint JSON body into {@link OAuth2Tokens}.
 *
 * Maps `access_token`, `refresh_token`, `expires_in`, `scope`, and `id_token`,
 * and keeps the raw payload under `raw` for provider-specific fields.
 *
 * @param data - Parsed token response object
 */
export function getOAuth2Tokens(data: object): OAuth2Tokens {
  const getDate = (seconds: number) => {
    const now = new Date();
    return new Date(now.getTime() + seconds * 1000);
  };

  const record = data as Record<string, unknown>;
  const expiresIn =
    typeof record.expires_in === "number" ? record.expires_in : undefined;
  const refreshTokenExpiresIn =
    typeof record.refresh_token_expires_in === "number"
      ? record.refresh_token_expires_in
      : undefined;
  const scope = record.scope;

  return {
    accessToken:
      typeof record.access_token === "string" ? record.access_token : undefined,
    accessTokenExpiresAt:
      typeof expiresIn === "number" ? getDate(expiresIn) : undefined,
    idToken: typeof record.id_token === "string" ? record.id_token : undefined,
    raw: record,
    refreshToken:
      typeof record.refresh_token === "string"
        ? record.refresh_token
        : undefined,
    refreshTokenExpiresAt:
      typeof refreshTokenExpiresIn === "number"
        ? getDate(refreshTokenExpiresIn)
        : undefined,
    scopes: scope
      ? typeof scope === "string"
        ? scope.split(" ")
        : Array.isArray(scope)
          ? scope.filter((s): s is string => typeof s === "string")
          : []
      : [],
    tokenType:
      typeof record.token_type === "string" ? record.token_type : undefined,
  };
}

/**
 * Fill in `accessTokenExpiresAt` when the token response omitted `expires_in`.
 */
export function applyDefaultAccessTokenExpiry(
  tokens: OAuth2Tokens,
  accessTokenExpiresIn: number | undefined
): OAuth2Tokens {
  if (!tokens.accessTokenExpiresAt && accessTokenExpiresIn) {
    tokens.accessTokenExpiresAt = new Date(
      Date.now() + accessTokenExpiresIn * 1000
    );
  }
  return tokens;
}
