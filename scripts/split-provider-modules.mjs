/**
 * Extract type blocks from large social-provider modules into *-types.ts
 * and rewrite the factory file as a thin re-export shell when keys are separate.
 *
 * This script is intentionally conservative: it only runs the extractions we
 * wire below. Re-run after hand-editing type blocks if line numbers drift.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sp = path.join(root, "src/auth/social-providers");

function write(rel, content) {
  const full = path.join(sp, rel);
  fs.writeFileSync(full, content.endsWith("\n") ? content : `${content}\n`);
  console.log("wrote", rel);
}

// --- PayPal ---
{
  const src = fs.readFileSync(path.join(sp, "paypal.ts"), "utf8");
  const typesStart = src.indexOf("export interface PayPalProfile");
  const factoryStart = src.indexOf("export const paypal");
  const types = src.slice(typesStart, factoryStart).trim();
  write(
    "paypal-types.ts",
    `import type { ProviderOptions } from '../oauth2/index.ts'

/**
 * PayPal Login with PayPal userinfo profile (schema paypalv1.1).
 * @see https://developer.paypal.com/docs/log-in-with-paypal/
 */
${types}
`
  );
  write(
    "paypal-keys.ts",
    `import { getJwksPublicKey } from './helpers/get-jwks-public-key.ts'

/**
 * Import the PayPal JWKS public key matching \`kid\` for RS256 ID-token verify.
 *
 * @param kid - Key id from the JWT protected header
 * @param jwksUri - Sandbox or live JWKS endpoint
 */
export const getPayPalPublicKey = async (kid: string, jwksUri: string) => {
  return getJwksPublicKey(jwksUri, kid)
}
`
  );
}

// --- Apple ---
{
  const src = fs.readFileSync(path.join(sp, "apple.ts"), "utf8");
  const typesStart = src.indexOf("export interface AppleProfile");
  const optionsEnd = src.indexOf("async function sha256Hex");
  const types = src.slice(typesStart, optionsEnd).trim();
  write(
    "apple-types.ts",
    `import type { ProviderOptions } from '../oauth2/index.ts'

/**
 * Claims from a Sign in with Apple identity token (\`id_token\`).
 * @see https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_rest_api/authenticating_users_with_sign_in_with_apple
 */
${types}
`
  );
  write(
    "apple-keys.ts",
    `import { getJwksPublicKey } from './helpers/get-jwks-public-key.ts'

/**
 * Fetch Apple's JWKS and import the key for the given JWT \`kid\`.
 * @see https://appleid.apple.com/auth/keys
 */
export const getApplePublicKey = async (kid: string) => {
  return getJwksPublicKey('https://appleid.apple.com/auth/keys', kid)
}
`
  );
  write(
    "apple-crypto.ts",
    `/**
 * SHA-256 hex digest of a UTF-8 string (used for Apple nonce comparison).
 * Apple may place either the raw nonce or its SHA-256 hash in the ID token.
 */
export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Whether the JWT \`nonce\` claim matches the expected OAuth nonce
 * (raw equality or SHA-256 hex of the original nonce).
 */
export async function nonceMatches(
  jwtNonce: unknown,
  nonce: string,
): Promise<boolean> {
  if (typeof jwtNonce !== 'string') {
    return false
  }
  if (jwtNonce === nonce) {
    return true
  }
  return jwtNonce === (await sha256Hex(nonce))
}
`
  );
}

// --- Cognito ---
{
  const src = fs.readFileSync(path.join(sp, "cognito.ts"), "utf8");
  const typesStart = src.indexOf("export interface CognitoProfile");
  const factoryStart = src.indexOf("export const cognito");
  const types = src.slice(typesStart, factoryStart).trim();
  write(
    "cognito-types.ts",
    `import type { ProviderOptions } from '../oauth2/index.ts'

/**
 * Amazon Cognito User Pool ID-token / userinfo claims.
 * Custom attributes may appear as additional string keys.
 */
${types}
`
  );
  write(
    "cognito-keys.ts",
    `import { logger } from '../env/index.ts'
import { getJwksPublicKey } from './helpers/get-jwks-public-key.ts'

/**
 * Fetch the Cognito User Pool JWKS and import the key for \`kid\`.
 *
 * @param kid - JWT header key id
 * @param region - AWS region of the pool (e.g. \`us-east-1\`)
 * @param userPoolId - Cognito User Pool id
 */
export const getCognitoPublicKey = async (
  kid: string,
  region: string,
  userPoolId: string,
) => {
  const jwksUri = \`https://cognito-idp.\${region}.amazonaws.com/\${userPoolId}/.well-known/jwks.json\`
  try {
    return await getJwksPublicKey(jwksUri, kid)
  } catch (error) {
    logger.error('Failed to fetch Cognito public key:', error)
    throw error
  }
}
`
  );
}

// --- Facebook ---
{
  const src = fs.readFileSync(path.join(sp, "facebook.ts"), "utf8");
  const typesStart = src.indexOf("export interface FacebookProfile");
  const debugStart = src.indexOf("interface FacebookDebugTokenData");
  const optionsStart = src.indexOf("export interface FacebookOptions");
  const factoryStart = src.indexOf("export const facebook");
  const profile = src.slice(typesStart, debugStart).trim();
  const options = src.slice(optionsStart, factoryStart).trim();
  write(
    "facebook-types.ts",
    `import type { ProviderOptions } from '../oauth2/index.ts'

/**
 * Facebook Graph API user profile fields used by the OAuth provider.
 * @see https://developers.facebook.com/docs/graph-api/reference/user
 */
${profile}

/**
 * Configuration for the Facebook social provider.
 */
${options}
`
  );
  write(
    "facebook-verify.ts",
    `import { athenaFetch as betterFetch } from '../fetch.ts'
import { getPrimaryClientId } from '../oauth2/index.ts'
import type { FacebookOptions } from './facebook-types.ts'

interface FacebookDebugTokenData {
  app_id?: string
  is_valid?: boolean
  user_id?: string
}

/**
 * Validate an opaque Facebook access token against the configured app.
 *
 * Facebook access tokens are not audience-bound at Graph \`/me\`: a token
 * minted for any Facebook app returns that app's profile. Without this check,
 * a token issued to an unrelated app could be accepted on the direct sign-in
 * path. Calls \`debug_token\` and requires the token to be valid, bound to one
 * of the configured client ids, and tied to a user.
 *
 * @see https://developers.facebook.com/docs/facebook-login/guides/access-tokens/debugging
 *
 * @returns The inspected token's \`user_id\` when valid, otherwise \`null\`.
 */
export async function verifyFacebookAccessToken(
  accessToken: string,
  options: FacebookOptions,
): Promise<string | null> {
  const primaryClientId = getPrimaryClientId(options.clientId)
  if (!primaryClientId || !options.clientSecret) {
    return null
  }
  const clientIds = Array.isArray(options.clientId)
    ? options.clientId
    : [options.clientId]
  const appAccessToken = \`\${primaryClientId}|\${options.clientSecret}\`
  const { data, error } = await betterFetch<{ data?: FacebookDebugTokenData }>(
    'https://graph.facebook.com/debug_token',
    {
      query: {
        input_token: accessToken,
        access_token: appAccessToken,
      },
    },
  )
  if (error || !data?.data) {
    return null
  }
  const { is_valid, app_id, user_id } = data.data
  if (is_valid !== true || !app_id || !clientIds.includes(app_id) || !user_id) {
    return null
  }
  return user_id
}
`
  );
}

// --- Zoom ---
{
  const src = fs.readFileSync(path.join(sp, "zoom.ts"), "utf8");
  const typesStart = src.indexOf("export type LoginType");
  const factoryStart = src.indexOf("export const zoom");
  const types = src.slice(typesStart, factoryStart).trim();
  write(
    "zoom-types.ts",
    `import type { ProviderOptions } from '../oauth2/index.ts'
import type { AccountStatus } from './account-status.ts'

/**
 * Zoom OAuth / Users API profile and related option types.
 * @see https://developers.zoom.us/docs/api/users/#tag/users/GET/users/{userId}
 */
${types}
`
  );
}

// --- Microsoft keys ---
write(
  "microsoft-keys.ts",
  `import { getJwksPublicKey } from './helpers/get-jwks-public-key.ts'

/**
 * Import the Microsoft Entra ID JWKS public key for the given JWT \`kid\`.
 *
 * @param kid - JWT protected-header key id
 * @param tenant - Tenant id or common/organizations/consumers
 * @param authority - Authority host (no trailing slash), e.g. login.microsoftonline.com
 */
export const getMicrosoftPublicKey = async (
  kid: string,
  tenant: string,
  authority: string,
) => {
  return getJwksPublicKey(
    \`\${authority}/\${tenant}/discovery/v2.0/keys\`,
    kid,
  )
}
`
);

console.log("type/key modules written — rewrite factory files next");
