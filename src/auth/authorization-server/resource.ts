import { OAuthProtocolError } from "./errors.ts";
import type { OAuthClient } from "./types.ts";

export function normalizeResourceUri(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new OAuthProtocolError(
      "invalid_request",
      "resource must be an absolute URI."
    );
  }
  if (url.username || url.password || url.hash) {
    throw new OAuthProtocolError(
      "invalid_request",
      "resource contains forbidden URL components."
    );
  }
  return url.toString().replace(/\/$/, "");
}

export function assertClientResource(
  client: OAuthClient,
  resource: string
): string {
  const normalized = normalizeResourceUri(resource);
  if (!client.resourceUris.includes(normalized)) {
    throw new OAuthProtocolError(
      "invalid_request",
      "The requested resource is not registered for this client."
    );
  }
  return normalized;
}
