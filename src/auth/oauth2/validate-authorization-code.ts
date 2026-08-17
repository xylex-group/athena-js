import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { AwaitableFunction } from "../types/index.ts";
import { base64 } from "../utils/base64.ts";
import type { ProviderOptions } from "./index.ts";
import { getOAuth2Tokens } from "./index.ts";
import {
  assertResponseNotRedirect,
  fetchRefusingRedirects,
  NO_FOLLOW_REDIRECT,
} from "./reject-redirects.ts";
import { getPrimaryClientId } from "./utils.ts";

export async function authorizationCodeRequest({
  code,
  codeVerifier,
  redirectURI,
  options,
  authentication,
  deviceId,
  headers,
  additionalParams = {},
  resource,
}: {
  code: string;
  redirectURI: string;
  options: AwaitableFunction<Partial<ProviderOptions>>;
  codeVerifier?: string | undefined;
  deviceId?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  headers?: Record<string, string> | undefined;
  additionalParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}) {
  options = typeof options === "function" ? await options() : options;
  return createAuthorizationCodeRequest({
    additionalParams,
    authentication,
    code,
    codeVerifier,
    deviceId,
    headers,
    options,
    redirectURI,
    resource,
  });
}

/**
 * @deprecated use async'd authorizationCodeRequest instead
 */
export function createAuthorizationCodeRequest({
  code,
  codeVerifier,
  redirectURI,
  options,
  authentication,
  deviceId,
  headers,
  additionalParams = {},
  resource,
}: {
  code: string;
  redirectURI: string;
  options: Partial<ProviderOptions>;
  codeVerifier?: string | undefined;
  deviceId?: string | undefined;
  authentication?: ("basic" | "post") | undefined;
  headers?: Record<string, string> | undefined;
  additionalParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}) {
  const body = new URLSearchParams();
  const requestHeaders: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/x-www-form-urlencoded",
    ...headers,
  };

  body.set("grant_type", "authorization_code");
  body.set("code", code);
  if (codeVerifier) {
    body.set("code_verifier", codeVerifier);
  }
  if (options.clientKey) {
    body.set("client_key", options.clientKey);
  }
  if (deviceId) {
    body.set("device_id", deviceId);
  }
  body.set("redirect_uri", options.redirectURI || redirectURI);
  if (resource) {
    if (typeof resource === "string") {
      body.append("resource", resource);
    } else {
      for (const _resource of resource) {
        body.append("resource", _resource);
      }
    }
  }
  // Use standard Base64 encoding for HTTP Basic Auth (OAuth2 spec, RFC 7617)
  // Fixes compatibility with providers like Notion, Twitter, etc.
  const primaryClientId = getPrimaryClientId(options.clientId);
  if (authentication === "basic") {
    const encodedCredentials = base64.encode(
      `${primaryClientId ?? ""}:${options.clientSecret ?? ""}`
    );
    requestHeaders.authorization = `Basic ${encodedCredentials}`;
  } else {
    if (primaryClientId) {
      body.set("client_id", primaryClientId);
    }
    if (options.clientSecret) {
      body.set("client_secret", options.clientSecret);
    }
  }

  for (const [key, value] of Object.entries(additionalParams)) {
    if (!body.has(key)) {
      body.append(key, value);
    }
  }

  return {
    body,
    headers: requestHeaders,
  };
}

/**
 * Exchange an authorization code for OAuth2 tokens at `tokenEndpoint`.
 *
 * Builds the form body via {@link authorizationCodeRequest}, posts with
 * redirect-refusing fetch, and normalizes the JSON via {@link getOAuth2Tokens}.
 *
 * @throws When the token endpoint returns an error response body
 */
export async function validateAuthorizationCode({
  code,
  codeVerifier,
  redirectURI,
  options,
  tokenEndpoint,
  authentication,
  deviceId,
  headers,
  additionalParams = {},
  resource,
}: {
  code: string;
  redirectURI: string;
  options: AwaitableFunction<Partial<ProviderOptions>>;
  codeVerifier?: string | undefined;
  deviceId?: string | undefined;
  tokenEndpoint: string;
  authentication?: ("basic" | "post") | undefined;
  headers?: Record<string, string> | undefined;
  additionalParams?: Record<string, string> | undefined;
  resource?: (string | string[]) | undefined;
}) {
  const { body, headers: requestHeaders } = await authorizationCodeRequest({
    additionalParams,
    authentication,
    code,
    codeVerifier,
    deviceId,
    headers,
    options,
    redirectURI,
    resource,
  });

  const { data, error } = await fetchRefusingRedirects<object>(tokenEndpoint, {
    body,
    headers: requestHeaders,
    method: "POST",
  });
  if (error) {
    throw error;
  }
  const tokens = getOAuth2Tokens(data);
  return tokens;
}

export async function validateToken(
  token: string,
  jwksEndpoint: string,
  options?: {
    audience?: string | string[];
    issuer?: string | string[];
  }
) {
  const jwks = createRemoteJWKSet(new URL(jwksEndpoint), {
    [customFetch]: async (url, init) => {
      const response = await fetch(url, { ...init, ...NO_FOLLOW_REDIRECT });
      assertResponseNotRedirect(String(url), response);
      return response;
    },
  });
  const verified = await jwtVerify(token, jwks, {
    audience: options?.audience,
    issuer: options?.issuer,
  });
  return verified;
}
