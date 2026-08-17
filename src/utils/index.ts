export {
  hasAuthSessionCookie,
  SESSION_COOKIE_PATTERNS,
} from "../cookies/session-cookie-detection.ts";
export type {
  AthenaAuthClientBaseUrlOptions,
  AthenaAuthUpstreamEnv,
  AthenaAuthUpstreamEnvKey,
  EnvLike,
} from "./athena-auth-url.ts";
export {
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_PARAM,
  ATHENA_AUTH_DISABLE_COOKIE_CACHE_QUERY_VALUE,
  ATHENA_AUTH_GET_SESSION_ABSOLUTE_PATH,
  ATHENA_AUTH_GET_SESSION_PATH,
  ATHENA_AUTH_PATH,
  ATHENA_AUTH_UPSTREAM_ENV_KEYS,
  ATHENA_AUTH_UPSTREAM_URL_ENV_NAMES,
  ATHENA_AUTH_VERIFY_EMAIL_PATH,
  ATHENA_SESSION_DATA_HEADER,
  AUTH_SESSION_PATH,
  createFreshSessionLookupUrl,
  DEFAULT_ATHENA_AUTH_ORIGIN,
  DEFAULT_ATHENA_AUTH_UPSTREAM_URL,
  DISABLE_COOKIE_CACHE_QUERY_PARAM,
  DISABLE_COOKIE_CACHE_QUERY_VALUE,
  isAbsoluteUrl,
  LOCAL_DEV_ORIGIN,
  normalizeAthenaAuthBaseUrl,
  readAthenaAuthUpstreamUrlFromEnv,
  resolveAthenaAuthClientBaseUrl,
  resolveAthenaAuthRequestUrl,
  resolveAthenaAuthUpstreamUrl,
  resolveEmailVerificationCallbackUrl,
  SESSION_DATA_HEADER,
} from "./athena-auth-url.ts";
export type {
  AthenaRequestHeaderOverrideFields,
  AthenaRequestHeaderProfile,
  BuildAthenaRequestHeadersInput,
  ResolvedRequestHeaderOverrides,
} from "./athena-request-headers.ts";
export {
  applyAthenaApiKeyHeaders,
  applyAthenaAuthContextHeaders,
  applyAthenaPgUriHeaders,
  buildAthenaGatewayHeaders,
  buildAthenaRequestHeaders,
  buildServiceRequestHeaders,
  hasHeaderIgnoreCase,
  resolveHeaderValue,
  resolveRequestHeaderOverrides,
} from "./athena-request-headers.ts";
export {
  ATHENA_AUTH_COOKIE_PREFIXES,
  type ClearAuthCookiesOptions,
  clearAuthCookies,
  DEFAULT_AUTH_COOKIE_PREFIXES,
  type SignOutAndClearAthenaSessionOptions,
  type SignOutAndClearAthenaSessionResult,
  signOutAndClearAthenaSession,
} from "./auth-cookies.ts";
export type {
  AuthMode,
  AuthModeRedirects,
  AuthRoutes,
  AuthView,
} from "./auth-routes.ts";
export {
  AUTH_DEFAULT_VIEW,
  AUTH_MODE_REDIRECTS,
  AUTH_MODE_SET,
  AUTH_ROUTES,
  AUTH_TWO_FACTOR_SEGMENT,
  AUTH_VIEW_BY_SEGMENT,
  AUTHENTICATED_REDIRECT_MODE_SET,
  AUTHENTICATED_REDIRECT_VIEW_SET,
  createAuthModeRedirects,
  createAuthRoutes,
  isAuthMode,
  resolveAuthModeRedirect,
  resolveAuthViewFromSegment,
  shouldRedirectAuthenticatedAuthMode,
  shouldRedirectAuthenticatedAuthView,
} from "./auth-routes.ts";
export {
  asBoolean,
  asBooleanOrNull,
  asIdentifier,
  asNonEmptyString,
  asNumber,
  asRecord,
  asString,
  asStringArray,
  firstString,
  readTrimmedString,
} from "./coercions.ts";
export { isLocalHostname } from "./hostname.ts";
export { parseBooleanFlag } from "./parse-boolean-flag.ts";
export { proxyRequestHeaders } from "./proxy-request-headers.ts";
export {
  type GetOriginFromHeadersOptions,
  getOriginFromHeaders,
  isDynamicServerUsageError,
} from "./request-origin.ts";
export { readEnv, requireEnv } from "./require-env.ts";
export { slugify } from "./slugify.ts";
export {
  escapeLikePatternValue,
  quoteSqlStringLiteral,
  sqlBigInt,
  sqlJsonbLiteral,
  sqlNullableText,
  sqlText,
} from "./sql-literals.ts";
export { trimTrailingSlashes } from "./trim-trailing-slashes.ts";

// ATHENA_AUTH_COOKIE_PREFIXES / ClearAuthCookiesOptions re-exported with clearAuthCookies above
