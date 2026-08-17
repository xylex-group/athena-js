import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sp = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src/auth/social-providers"
);

function rewrite(file, { header, exportStart }) {
  const full = path.join(sp, file);
  const src = fs.readFileSync(full, "utf8");
  const i = src.indexOf(exportStart);
  if (i < 0) {
    throw new Error(`missing ${exportStart} in ${file}`);
  }
  let body = src.slice(i);
  body = body.replace(/\nexport const get\w+PublicKey[\s\S]*$/, "\n");
  fs.writeFileSync(full, `${header}${body.trimStart()}\n`);
  console.log("rewrote", file);
}

rewrite("paypal.ts", {
  exportStart: "export const paypal",
  header: `import { base64 } from "../utils/base64.ts";
import { athenaFetch as betterFetch } from "../fetch.ts";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import { createAuthorizationURL } from "../oauth2/index.ts";
import { getPayPalPublicKey } from "./paypal-keys.ts";
import type {
	PayPalOptions,
	PayPalProfile,
	PayPalTokenResponse,
} from "./paypal-types.ts";

export type {
	PayPalOptions,
	PayPalProfile,
	PayPalTokenResponse,
} from "./paypal-types.ts";
export { getPayPalPublicKey } from "./paypal-keys.ts";

/**
 * ID token signing algorithms advertised by PayPal's OpenID configuration.
 * Anything outside this allowlist is rejected so each token is only ever
 * verified with the algorithm it was issued for.
 *
 * @see https://www.paypal.com/.well-known/openid-configuration
 */
const PAYPAL_ID_TOKEN_ALGORITHMS = ["RS256", "HS256"] as const;

/**
 * PayPal Login with PayPal OAuth provider factory.
 *
 * @param options - Client credentials and sandbox/live environment
 * @returns OAuth provider implementation for PayPal
 */
`,
});

rewrite("apple.ts", {
  exportStart: "export const apple",
  header: `import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
	createAuthorizationURL,
	getPrimaryClientId,
	refreshAccessToken,
	validateAuthorizationCode,
} from "../oauth2/index.ts";
import { nonceMatches } from "./apple-crypto.ts";
import { getApplePublicKey } from "./apple-keys.ts";
import type { AppleOptions, AppleProfile } from "./apple-types.ts";
import { mergeScopes } from "./helpers/merge-scopes.ts";

export type {
	AppleNonConformUser,
	AppleOptions,
	AppleProfile,
} from "./apple-types.ts";
export { getApplePublicKey } from "./apple-keys.ts";

/**
 * Sign in with Apple OAuth provider factory.
 *
 * Uses \`response_mode=form_post\` and \`code id_token\` when requesting
 * name/email scopes (Apple REST API requirements).
 *
 * @param options - Apple Services ID / client secret configuration
 */
`,
});

// Fix apple factory to use mergeScopes - optional later

rewrite("cognito.ts", {
  exportStart: "export const cognito",
  header: `import { athenaFetch as betterFetch } from "../fetch.ts";
import { decodeJwt, decodeProtectedHeader, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
	createAuthorizationURL,
	getPrimaryClientId,
	refreshAccessToken,
	validateAuthorizationCode,
} from "../oauth2/index.ts";
import { getCognitoPublicKey } from "./cognito-keys.ts";
import type { CognitoOptions, CognitoProfile } from "./cognito-types.ts";

export type { CognitoOptions, CognitoProfile } from "./cognito-types.ts";
export { getCognitoPublicKey } from "./cognito-keys.ts";

/**
 * Amazon Cognito Hosted UI OAuth provider factory.
 *
 * @param options - Domain, region, user pool id, and app client settings
 */
`,
});

rewrite("facebook.ts", {
  exportStart: "export const facebook",
  header: `import { athenaFetch as betterFetch } from "../fetch.ts";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { logger } from "../env/index.ts";
import { AthenaAuthError } from "../error.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
	createAuthorizationURL,
	getPrimaryClientId,
	refreshAccessToken,
	validateAuthorizationCode,
} from "../oauth2/index.ts";
import type { FacebookOptions, FacebookProfile } from "./facebook-types.ts";
import { verifyFacebookAccessToken } from "./facebook-verify.ts";

export type { FacebookOptions, FacebookProfile } from "./facebook-types.ts";
export { verifyFacebookAccessToken } from "./facebook-verify.ts";

/**
 * Facebook Login OAuth provider factory (Graph API v24).
 *
 * Supports limited-login JWT ID tokens and opaque access tokens (with
 * \`debug_token\` app binding).
 *
 * @param options - App id/secret and optional field extensions
 */
`,
});

rewrite("zoom.ts", {
  exportStart: "export const zoom",
  header: `import { athenaFetch as betterFetch } from "../fetch.ts";
import type { OAuthProvider } from "../oauth2/index.ts";
import {
	generateCodeChallenge,
	refreshAccessToken,
	validateAuthorizationCode,
} from "../oauth2/index.ts";
import type { ZoomOptions, ZoomProfile } from "./zoom-types.ts";

export type {
	LoginType,
	PhoneNumber,
	PronounOption,
	ZoomOptions,
	ZoomProfile,
} from "./zoom-types.ts";

/**
 * Zoom OAuth provider factory (Users API).
 *
 * @param userOptions - Client id/secret; PKCE defaults to enabled
 * @see https://developers.zoom.us/docs/integrations/oauth/
 */
`,
});

// Microsoft
{
  let src = fs.readFileSync(path.join(sp, "microsoft-entra-id.ts"), "utf8");
  src = src.replace(
    'import { getJwksPublicKey } from "./helpers/get-jwks-public-key.ts";\n',
    ""
  );
  if (!src.includes("microsoft-keys")) {
    src = src.replace(
      'import { trimTrailingSlash } from "./helpers/trim-trailing-slash.ts";',
      `import { trimTrailingSlash } from "./helpers/trim-trailing-slash.ts";
import { getMicrosoftPublicKey } from "./microsoft-keys.ts";`
    );
  }
  src = src.replace(/\nexport const getMicrosoftPublicKey[\s\S]*$/, "\n");
  if (!src.includes("export { getMicrosoftPublicKey }")) {
    src = src.replace(
      'export { MICROSOFT_CONSUMER_TENANT_ID } from "./microsoft-types.ts";',
      `export { MICROSOFT_CONSUMER_TENANT_ID } from "./microsoft-types.ts";
export { getMicrosoftPublicKey } from "./microsoft-keys.ts";

/**
 * Microsoft Entra ID (Azure AD) OAuth provider factory.
 *
 * Supports multi-tenant endpoints (common/organizations/consumers) with
 * explicit tenant-class checks on ID tokens.
 *
 * @param options - Client id, optional tenant/authority, profile photo settings
 */`
    );
  }
  fs.writeFileSync(path.join(sp, "microsoft-entra-id.ts"), src);
  console.log("rewrote microsoft-entra-id.ts");
}

console.log("done");
