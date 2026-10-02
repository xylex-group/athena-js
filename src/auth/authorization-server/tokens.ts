import type { OAuthAccessTokenClaims } from "./types.ts";

export const OAUTH_SECRET_BYTES = 32;

export function generateOpaqueSecret(
  bytes = OAUTH_SECRET_BYTES
): string {
  if (!Number.isInteger(bytes) || bytes < 32 || bytes > 128) {
    throw new RangeError("OAuth secrets must contain between 32 and 128 bytes.");
  }
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString(
    "base64url"
  );
}

export async function hashOAuthSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return Buffer.from(digest).toString("base64url");
}

async function stateKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    [usage]
  );
}

export async function sealOAuthState(
  state: string,
  secret: string
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { iv, name: "AES-GCM" },
    await stateKey(secret, "encrypt"),
    new TextEncoder().encode(state)
  );
  const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
  packed.set(iv);
  packed.set(new Uint8Array(encrypted), iv.byteLength);
  return Buffer.from(packed).toString("base64url");
}

export async function openOAuthState(
  ciphertext: string,
  secret: string
): Promise<string> {
  const packed = Buffer.from(ciphertext, "base64url");
  if (packed.byteLength <= 12) {
    throw new Error("Invalid OAuth state");
  }
  const plaintext = await crypto.subtle.decrypt(
    { iv: packed.subarray(0, 12), name: "AES-GCM" },
    await stateKey(secret, "decrypt"),
    packed.subarray(12)
  );
  return new TextDecoder().decode(plaintext);
}

export interface IssuedOAuthTokenSet {
  accessToken: string;
  expiresIn: number;
  familyId?: string;
  grantId: string;
  idToken?: string;
  identityScopes?: readonly string[];
  refreshToken?: string;
  scopes: readonly string[];
}

export interface OAuthTokenEndpointResponse {
  access_token: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
  scope: string;
  token_type: "Bearer";
}

export function projectOAuthTokenEndpointResponse(
  issued: IssuedOAuthTokenSet
): OAuthTokenEndpointResponse {
  return {
    access_token: issued.accessToken,
    expires_in: issued.expiresIn,
    ...(issued.idToken ? { id_token: issued.idToken } : {}),
    ...(issued.refreshToken ? { refresh_token: issued.refreshToken } : {}),
    scope: [...new Set([...issued.scopes, ...(issued.identityScopes ?? [])])]
      .sort()
      .join(" "),
    token_type: "Bearer",
  };
}

export function createAccessTokenClaims(input: {
  clientId: string;
  familyId?: string;
  grantId: string;
  identityScopes?: readonly string[];
  issuer: string;
  organizationId?: string | null;
  resource: string;
  scopes: readonly string[];
  subject: string;
  ttlSeconds: number;
  now?: Date;
}): OAuthAccessTokenClaims {
  const now = input.now ?? new Date();
  const iat = Math.floor(now.getTime() / 1000);
  return {
    aud: input.resource,
    athena_grant_id: input.grantId,
    athena_identity_scopes: [...new Set(input.identityScopes ?? [])].sort() as OAuthAccessTokenClaims["athena_identity_scopes"],
    ...(input.familyId ? { athena_token_family_id: input.familyId } : {}),
    ...(input.organizationId
      ? { athena_organization_id: input.organizationId }
      : {}),
    client_id: input.clientId,
    exp: iat + Math.max(1, Math.trunc(input.ttlSeconds)),
    iat,
    iss: input.issuer,
    jti: crypto.randomUUID(),
    nbf: iat,
    scope: [...input.scopes].sort().join(" "),
    sub: input.subject,
  };
}
