import type { AwaitableFunction } from "../types/index.ts";
import { base64 } from "../utils/base64.ts";
import { fetchRefusingRedirects } from "./reject-redirects.ts";
import type { OAuth2Tokens, ProviderOptions } from "./types.ts";

export async function clientCredentialsTokenRequest({
  options,
  scope,
  authentication,
  resource,
}: {
  options: AwaitableFunction<ProviderOptions & { clientSecret: string }>;
  scope?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}) {
  options = typeof options === "function" ? await options() : options;
  return createClientCredentialsTokenRequest({
    authentication,
    options,
    resource,
    scope,
  });
}

/**
 * @deprecated use async'd clientCredentialsTokenRequest instead
 */
export function createClientCredentialsTokenRequest({
  options,
  scope,
  authentication,
  resource,
}: {
  options: ProviderOptions & { clientSecret: string };
  scope?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}) {
  const body = new URLSearchParams();
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
  };

  body.set("grant_type", "client_credentials");
  if (scope) {
    body.set("scope", scope);
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
  if (authentication === "basic") {
    const primaryClientId = Array.isArray(options.clientId)
      ? options.clientId[0]
      : options.clientId;
    // HTTP Basic Auth requires standard Base64 (RFC 7617), not base64url.
    const encodedCredentials = base64.encode(
      `${primaryClientId}:${options.clientSecret}`
    );
    headers.authorization = `Basic ${encodedCredentials}`;
  } else {
    const primaryClientId = Array.isArray(options.clientId)
      ? options.clientId[0]
      : options.clientId;
    body.set("client_id", primaryClientId);
    body.set("client_secret", options.clientSecret);
  }

  return {
    body,
    headers,
  };
}

export async function clientCredentialsToken({
  options,
  tokenEndpoint,
  scope,
  authentication,
  resource,
}: {
  options: AwaitableFunction<ProviderOptions & { clientSecret: string }>;
  tokenEndpoint: string;
  scope: string;
  authentication?: ("basic" | "post") | undefined;
  resource?: (string | string[]) | undefined;
}): Promise<OAuth2Tokens> {
  const { body, headers } = await clientCredentialsTokenRequest({
    authentication,
    options,
    resource,
    scope,
  });

  const { data, error } = await fetchRefusingRedirects<{
    access_token: string;
    expires_in?: number | undefined;
    token_type?: string | undefined;
    scope?: string | undefined;
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
    scopes: data.scope?.split(" "),
    tokenType: data.token_type,
  };

  if (data.expires_in) {
    const now = new Date();
    tokens.accessTokenExpiresAt = new Date(
      now.getTime() + data.expires_in * 1000
    );
  }

  return tokens;
}
