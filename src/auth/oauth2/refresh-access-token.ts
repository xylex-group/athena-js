import type { AwaitableFunction } from "../types/index.ts";
import { base64 } from "../utils/base64.ts";
import { fetchRefusingRedirects } from "./reject-redirects.ts";
import type { OAuth2Tokens, ProviderOptions } from "./types.ts";
import { getPrimaryClientId } from "./utils.ts";

export async function refreshAccessTokenRequest({
  refreshToken,
  options,
  authentication,
  extraParams,
  resource,
}: {
  refreshToken: string;
  options: AwaitableFunction<Partial<ProviderOptions>>;
  authentication?: ("basic" | "post") | undefined;
  extraParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}) {
  options = typeof options === "function" ? await options() : options;
  return createRefreshAccessTokenRequest({
    authentication,
    extraParams,
    options,
    refreshToken,
    resource,
  });
}

/**
 * @deprecated use async'd refreshAccessTokenRequest instead
 */
export function createRefreshAccessTokenRequest({
  refreshToken,
  options,
  authentication,
  extraParams,
  resource,
}: {
  refreshToken: string;
  options: ProviderOptions;
  authentication?: ("basic" | "post") | undefined;
  extraParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}) {
  const body = new URLSearchParams();
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  // Use standard Base64 encoding for HTTP Basic Auth (OAuth2 spec, RFC 7617)
  // Fixes compatibility with providers like Notion, Twitter, etc.
  const primaryClientId = getPrimaryClientId(options.clientId);
  if (authentication === "basic") {
    if (primaryClientId) {
      headers.authorization =
        "Basic " +
        base64.encode(`${primaryClientId}:${options.clientSecret ?? ""}`);
    } else {
      headers.authorization = `Basic ${base64.encode(`:${options.clientSecret ?? ""}`)}`;
    }
  } else {
    if (primaryClientId) {
      body.set("client_id", primaryClientId);
    }
    if (options.clientSecret) {
      body.set("client_secret", options.clientSecret);
    }
  }

  if (resource) {
    if (typeof resource === "string") {
      body.append("resource", resource);
    } else {
      for (const _resource of resource) {
        body.append("resource", _resource);
      }
    }
  }
  if (extraParams) {
    for (const [key, value] of Object.entries(extraParams)) {
      body.set(key, value);
    }
  }

  return {
    body,
    headers,
  };
}

/**
 * Refresh an access token using a refresh_token grant.
 *
 * Posts to `tokenEndpoint` (redirect-refusing) and maps the response to
 * {@link OAuth2Tokens}. Supports basic or post client authentication.
 */
export async function refreshAccessToken({
  refreshToken,
  options,
  tokenEndpoint,
  authentication,
  extraParams,
}: {
  refreshToken: string;
  options: Partial<ProviderOptions>;
  tokenEndpoint: string;
  authentication?: ("basic" | "post") | undefined;
  extraParams?: Record<string, string> | undefined;
}): Promise<OAuth2Tokens> {
  const { body, headers } = await createRefreshAccessTokenRequest({
    authentication,
    extraParams,
    options,
    refreshToken,
  });

  const { data, error } = await fetchRefusingRedirects<{
    access_token: string;
    refresh_token?: string | undefined;
    expires_in?: number | undefined;
    refresh_token_expires_in?: number | undefined;
    token_type?: string | undefined;
    scope?: string | undefined;
    id_token?: string | undefined;
  }>(tokenEndpoint, {
    body,
    headers,
    method: "POST",
  });
  if (error) {
    throw error;
  }
  const tokens: OAuth2Tokens = {
    accessToken: data.access_token,
    idToken: data.id_token,
    refreshToken: data.refresh_token,
    scopes: data.scope?.split(" "),
    tokenType: data.token_type,
  };

  if (data.expires_in) {
    const now = new Date();
    tokens.accessTokenExpiresAt = new Date(
      now.getTime() + data.expires_in * 1000
    );
  }

  if (data.refresh_token_expires_in) {
    const now = new Date();
    tokens.refreshTokenExpiresAt = new Date(
      now.getTime() + data.refresh_token_expires_in * 1000
    );
  }

  return tokens;
}
