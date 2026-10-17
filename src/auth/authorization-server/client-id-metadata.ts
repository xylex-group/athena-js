import { OAuthProtocolError } from "./errors.ts";
import { normalizeRegisteredRedirectUri } from "./redirect-uri.ts";
import type { OAuthClient } from "./types.ts";

const DOT_SEGMENT = /(^|\/)(\.|\.\.)(\/|$)/;
const DEFAULT_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 64 * 1024;
const ATHENA_TOKEN_ENDPOINT_AUTH_METHODS = ["none"] as const;

export interface ClientIdMetadataDocument {
  clientId: string;
  clientName: string;
  clientUri: string | null;
  grantTypes: readonly string[];
  logoUri: string | null;
  redirectUris: readonly string[];
  responseTypes: readonly string[];
  tokenEndpointAuthMethods: readonly string[];
}

export interface FetchClientIdMetadataOptions {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export function isClientIdMetadataDocumentUrl(clientId: string): boolean {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") {
    return false;
  }
  if (!url.pathname || url.pathname === "/") {
    return false;
  }
  if (url.username || url.password || url.hash) {
    return false;
  }
  if (DOT_SEGMENT.test(url.pathname)) {
    return false;
  }
  // Exact string comparison is required later; reject unexpected encoding forms.
  return url.href === clientId || url.toString() === clientId;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) {
    throw new OAuthProtocolError(
      "invalid_client",
      `Client metadata ${field} must be an array.`
    );
  }
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new OAuthProtocolError(
        "invalid_client",
        `Client metadata ${field} entries must be non-empty strings.`
      );
    }
    values.push(entry);
  }
  return values;
}

function resolveTokenEndpointAuthMethods(
  document: Record<string, unknown>
): string[] {
  if (Array.isArray(document.token_endpoint_auth_methods_supported)) {
    return asStringArray(
      document.token_endpoint_auth_methods_supported,
      "token_endpoint_auth_methods_supported"
    );
  }
  if (typeof document.token_endpoint_auth_method === "string") {
    return [document.token_endpoint_auth_method];
  }
  // RFC 7591 default for omitted method is client_secret_basic; Athena only
  // supports public clients (`none`), so omission is rejected.
  throw new OAuthProtocolError(
    "invalid_client",
    "Client metadata must advertise token endpoint authentication methods."
  );
}

export function parseClientIdMetadataDocument(
  value: unknown,
  clientIdUrl: string
): ClientIdMetadataDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata document must be a JSON object."
    );
  }
  const document = value as Record<string, unknown>;
  if (document.client_id !== clientIdUrl) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata client_id must exactly match the client_id URL."
    );
  }
  if (typeof document.client_name !== "string" || !document.client_name.trim()) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata client_name is required."
    );
  }

  const redirectUris = asStringArray(document.redirect_uris, "redirect_uris").map(
    (uri) => normalizeRegisteredRedirectUri(uri)
  );
  if (redirectUris.length === 0) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata redirect_uris must contain at least one URI."
    );
  }

  const responseTypes = Array.isArray(document.response_types)
    ? asStringArray(document.response_types, "response_types")
    : ["code"];
  if (!responseTypes.includes("code")) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata response_types must include code."
    );
  }

  const grantTypes = Array.isArray(document.grant_types)
    ? asStringArray(document.grant_types, "grant_types")
    : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata grant_types must include authorization_code."
    );
  }

  const tokenEndpointAuthMethods = resolveTokenEndpointAuthMethods(document);
  const supportedIntersection = tokenEndpointAuthMethods.filter((method) =>
    (ATHENA_TOKEN_ENDPOINT_AUTH_METHODS as readonly string[]).includes(method)
  );
  if (!supportedIntersection.includes("none")) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata does not support Athena's token_endpoint_auth_method none."
    );
  }

  if (Array.isArray(document.code_challenge_methods_supported)) {
    const methods = asStringArray(
      document.code_challenge_methods_supported,
      "code_challenge_methods_supported"
    );
    if (!methods.includes("S256")) {
      throw new OAuthProtocolError(
        "invalid_client",
        "Client metadata code_challenge_methods_supported must include S256."
      );
    }
  }

  return {
    clientId: clientIdUrl,
    clientName: document.client_name.trim(),
    clientUri:
      typeof document.client_uri === "string" && document.client_uri.trim()
        ? document.client_uri.trim()
        : null,
    grantTypes,
    logoUri:
      typeof document.logo_uri === "string" && document.logo_uri.trim()
        ? document.logo_uri.trim()
        : null,
    redirectUris,
    responseTypes,
    tokenEndpointAuthMethods: supportedIntersection,
  };
}

export async function fetchClientIdMetadataDocument(
  clientIdUrl: string,
  options: FetchClientIdMetadataOptions = {}
): Promise<ClientIdMetadataDocument> {
  if (!isClientIdMetadataDocumentUrl(clientIdUrl)) {
    throw new OAuthProtocolError(
      "invalid_client",
      "client_id metadata documents must be https URLs with a path."
    );
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  let response: Response;
  try {
    response = await fetchImpl(clientIdUrl, {
      headers: {
        accept: "application/json",
      },
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Failed to fetch client metadata document.",
      { cause: error }
    );
  }

  if (!response.ok) {
    throw new OAuthProtocolError(
      "invalid_client",
      `Client metadata document returned HTTP ${response.status}.`
    );
  }

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata document exceeds the size limit."
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > maxBytes) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata document exceeds the size limit."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new OAuthProtocolError(
      "invalid_client",
      "Client metadata document is not valid JSON.",
      { cause: error }
    );
  }

  return parseClientIdMetadataDocument(parsed, clientIdUrl);
}

export function materializeClientIdMetadataClient(input: {
  document: ClientIdMetadataDocument;
  now?: Date;
  resourceUris: readonly string[];
  scopes: readonly string[];
}): OAuthClient {
  const now = input.now ?? new Date();
  return {
    clientName: input.document.clientName,
    clientType: "public",
    clientUrl: input.document.clientUri,
    createdAt: now,
    grantType: "authorization_code",
    id: input.document.clientId,
    isActive: true,
    metadata: {
      registrationSource: "client-id-metadata",
      ...(input.document.logoUri ? { logoUri: input.document.logoUri } : {}),
      tokenEndpointAuthMethods: [...input.document.tokenEndpointAuthMethods],
    },
    redirectUris: [...input.document.redirectUris],
    registrationKind: "client-id-metadata",
    resourceUris: [...input.resourceUris],
    responseType: "code",
    scopes: [...input.scopes],
    tokenEndpointAuthMethod: "none",
    updatedAt: now,
  };
}
