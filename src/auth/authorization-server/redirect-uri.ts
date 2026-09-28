import { OAuthProtocolError } from "./errors.ts";

function parseRedirectUri(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri must be an absolute URI."
    );
  }
  if (url.username || url.password || url.hash) {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri contains forbidden URL components."
    );
  }
  return url;
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

export function normalizeRegisteredRedirectUri(value: string): string {
  const url = parseRedirectUri(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri must use HTTPS except for loopback native redirects."
    );
  }
  return value;
}

export function redirectUriMatches(input: {
  clientType: "public";
  registeredUri: string;
  requestedUri: string;
}): boolean {
  const registered = parseRedirectUri(input.registeredUri);
  const requested = parseRedirectUri(input.requestedUri);
  const loopback =
    registered.protocol === "http:" &&
    requested.protocol === "http:" &&
    isLoopbackHost(registered.hostname) &&
    isLoopbackHost(requested.hostname);
  if (!loopback) {
    return input.registeredUri === input.requestedUri;
  }
  return (
    registered.protocol === requested.protocol &&
    registered.hostname === requested.hostname &&
    registered.pathname === requested.pathname &&
    registered.search === requested.search
  );
}

export function assertRedirectUri(input: {
  clientType: "public";
  registeredUris: readonly string[];
  requestedUri: string;
}): void {
  const registeredUris = input.registeredUris.map(normalizeRegisteredRedirectUri);
  const valid = registeredUris.some((registeredUri) =>
    redirectUriMatches({
      clientType: input.clientType,
      registeredUri,
      requestedUri: input.requestedUri,
    })
  );
  if (!valid) {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri does not match a registered redirect URI."
    );
  }
}
