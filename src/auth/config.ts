/**
 * Normalized Athena Auth execution + HTTP routing.
 *
 * Execution (`disabled` | `local` | `remote`) is distinct from HTTP routing
 * (`same-origin` | `direct` | `custom`). `auth: false` is disabled. Legacy
 * object configs without `mode` normalize to `remote`.
 */

import { AthenaConfigurationError } from "../config/errors.ts";
import {
  type AthenaAppIdentity,
  type AthenaAppIdentityInput,
  resolveAthenaAppIdentity,
} from "./app-identity.ts";
import { normalizeAuthBridgeDestinationOrigin } from "./bridge/code.ts";
import { ATHENA_AUTH_DEFAULT_BASE_PATH } from "./contract/index.ts";
import type { AthenaAuthHooks } from "./hooks/types.ts";
import { normalizeAthenaAuthObservability } from "./observability/config.ts";
import type {
  AthenaAuthObservabilityConfig,
  NormalizedAthenaAuthObservability,
} from "./observability/types.ts";
import { assertOriginOnlyIssuer } from "./protocol-identity.ts";
import type {
  AthenaAuthSocialOptions,
  AthenaAuthSocialProviderOptions,
  NormalizedSocialAuthConfig,
} from "./social/config.ts";
import { normalizeAuthSocialProviders } from "./social/config.ts";

export type {
  AthenaAppIdentity,
  AthenaAppIdentityInput,
} from "./app-identity.ts";
export { resolveAthenaAppIdentity } from "./app-identity.ts";

import {
  type AthenaPasskeyAuthenticationPolicy,
  type AthenaPasskeyRegistrationPolicy,
  normalizePasskeyAuthenticationPolicy,
  normalizePasskeyRegistrationPolicy,
} from "./passkey/policy.ts";

export type {
  AthenaPasskeyAuthenticationExtensions,
  AthenaPasskeyAuthenticationPolicy,
  AthenaPasskeyAuthenticatorAttachment,
  AthenaPasskeyRegistrationExtensions,
  AthenaPasskeyRegistrationPolicy,
  AthenaPasskeyResidentKey,
  AthenaPasskeyUserVerification,
} from "./passkey/policy.ts";
export type {
  AthenaAuthSocialOptions,
  AthenaAuthSocialProviderOptions,
  NormalizedSocialAuthConfig,
} from "./social/server/social-config.ts";

export type AthenaPasskeyOnboardingResolution =
  | { create: { email: string; name?: string } }
  | { existingUserId: string };

/** Ceremony fields forwarded by PasskeyButton / generate-register-options. */
export interface AthenaPasskeyCeremonyContext {
  email?: string;
  name?: string;
}

export interface AthenaPasskeyOnboardingOptions {
  createSession?: boolean;
  enabled?: boolean;
  resolveUser?: (
    context: AthenaPasskeyCeremonyContext,
  ) =>
    | AthenaPasskeyOnboardingResolution
    | Promise<AthenaPasskeyOnboardingResolution>;
}

/**
 * Default passkey-first onboarding map (T-ONB-01/02).
 * Apps omit `resolveUser` when `onboarding: true`.
 */
export function resolveAthenaPasskeyOnboardingUser(
  context: AthenaPasskeyCeremonyContext | unknown,
): AthenaPasskeyOnboardingResolution {
  const record = asRecord(context);
  const email = asString(record?.email);
  if (!email) {
    throw new Error("email is required to complete passkey onboarding");
  }
  const name = asString(record?.name);
  return name ? { create: { email, name } } : { create: { email } };
}

export type AthenaAuthExecutionMode = "disabled" | "local" | "remote";
export type AthenaAuthHttpRouting = "same-origin" | "direct" | "custom";

export interface AthenaAuthEmailAndPasswordOptions {
  autoSignIn?: boolean;
  enabled?: boolean;
  maxPasswordLength?: number;
  minPasswordLength?: number;
  requireEmailVerification?: boolean;
}

export interface AthenaAuthSessionOptions {
  cookieName?: string;
  disableSessionRefresh?: boolean;
  expiresInSeconds?: number;
  updateAgeSeconds?: number;
}

export interface AthenaAuthSecurityOptions {
  bodyLimitBytes?: number;
  cookieSecure?: boolean | "auto";
  trustedOrigins?: string[];
  trustedProxy?: boolean;
}

export interface AthenaAuthBridgeOptions {
  allowedOrigins?: string[];
  codeTtlSeconds?: number;
  enabled?: boolean;
}

export interface NormalizedAthenaAuthBridgeConfig {
  allowedOrigins: string[];
  codeTtlSeconds: number;
  enabled: boolean;
}

export interface AthenaAuthorizationServerResourceOptions {
  description?: string;
  scopes: Record<string, { description?: string }>;
}

export interface AthenaAuthorizationServerOptions {
  accessTokenTtlSeconds?: number;
  authorizationCodeTtlSeconds?: number;
  authorizationEndpoint?: string;
  authorizationRequestTtlSeconds?: number;
  consentUrl?: string;
  enabled?: boolean;
  issuer?: string;
  issueRefreshTokens?: boolean;
  refreshTokenTtlSeconds?: number;
  resources?: Record<string, AthenaAuthorizationServerResourceOptions>;
  signInUrl?: string;
}

export interface NormalizedAthenaAuthorizationServerResource {
  description?: string;
  scopes: Readonly<Record<string, { description?: string }>>;
}

export interface NormalizedAthenaAuthorizationServerConfig {
  accessTokenTtlSeconds: number;
  authorizationCodeTtlSeconds: number;
  authorizationEndpoint: string | null;
  authorizationRequestTtlSeconds: number;
  consentUrl: string | null;
  enabled: boolean;
  issuer: string | null;
  issueRefreshTokens: boolean;
  refreshTokenTtlSeconds: number;
  resources: Readonly<
    Record<string, NormalizedAthenaAuthorizationServerResource>
  >;
  signInUrl: string | null;
}

export interface AthenaAuthPasskeyOptions {
  authentication?: {
    extensions?: Record<string, never>;
    userVerification?: "discouraged" | "preferred" | "required";
  };
  challengeTtlSeconds?: number;
  enabled?: boolean;
  onboarding?: boolean | AthenaPasskeyOnboardingOptions;
  origins?: readonly string[];
  registration?: {
    authenticatorAttachment?: "cross-platform" | "platform";
    extensions?: { credProps?: boolean };
    residentKey?: "discouraged" | "preferred" | "required";
    userVerification?: "discouraged" | "preferred" | "required";
  };
  relatedOrigins?: readonly string[];
  rpId?: string;
  rpName?: string;
}

export interface AthenaAuthLocalConfig {
  /**
   * Explicit opt-in only. `createClient()` never auto-migrates production
   * Auth schema unless this is `true`.
   */
  autoMigrate?: boolean;
  authorizationServer?: AthenaAuthorizationServerOptions;
  basePath?: string;
  bridge?: AthenaAuthBridgeOptions;
  emailAndPassword?: AthenaAuthEmailAndPasswordOptions;
  /**
   * Embedded-only domain lifecycle hooks. Discarded by
   * `normalizeAthenaAuthConfig`; pass through `athenaAuthConfig()` into
   * `createAthenaAuthRuntime`.
   */
  hooks?: AthenaAuthHooks;
  mode: "local";
  oauth?: Record<string, AthenaAuthSocialProviderOptions>;
  /**
   * Embedded-only audit/trace tables. Discarded by
   * `normalizeAthenaAuthConfig`; pass through `athenaAuthConfig()` into
   * `createAthenaAuthRuntime`.
   */
  observability?: AthenaAuthObservabilityConfig;
  organizations?: { enabled?: boolean };
  passkey?: AthenaAuthPasskeyOptions;
  secret?: string;
  security?: AthenaAuthSecurityOptions;
  session?: AthenaAuthSessionOptions;
  social?: AthenaAuthSocialOptions;
  socialProviders?: Record<string, AthenaAuthSocialProviderOptions>;
}

export interface AthenaAuthRemoteConfig {
  credentials?: RequestCredentials;
  mode?: "remote";
  oauth?: Record<string, AthenaAuthSocialProviderOptions>;
  routing?: AthenaAuthHttpRouting;
  secret?: string;
  social?: AthenaAuthSocialOptions;
  socialProviders?: Record<string, AthenaAuthSocialProviderOptions>;
  upstreamUrl?: string | null;
  url?: string | null;
}

export type AthenaAuthPublicConfig =
  | AthenaAuthLocalConfig
  | AthenaAuthRemoteConfig
  | (Omit<AthenaAuthRemoteConfig, "mode"> & { mode?: undefined });

export type AthenaAuthInput =
  | false
  | AthenaAuthPublicConfig
  | Record<string, unknown>
  | null
  | undefined;

export interface NormalizedAthenaAuthConfig {
  appIdentity: AthenaAppIdentity | null;
  autoMigrate: boolean;
  basePath: string;
  bridge: NormalizedAthenaAuthBridgeConfig;
  authorizationServer: NormalizedAthenaAuthorizationServerConfig;
  emailAndPassword: Required<AthenaAuthEmailAndPasswordOptions>;
  execution: AthenaAuthExecutionMode;
  observability: NormalizedAthenaAuthObservability;
  organizationsEnabled: boolean;
  passkey: {
    authentication: AthenaPasskeyAuthenticationPolicy;
    challengeTtlSeconds: number;
    enabled: boolean;
    onboardingCreateSession: boolean;
    onboardingEnabled: boolean;
    origins: string[];
    registration: AthenaPasskeyRegistrationPolicy;
    relatedOrigins: string[];
    rpId: string | null;
    rpName: string | null;
  };
  /**
   * True when the operator supplied a `passkey` key (including `{}`).
   * Snapshot factory is the RP ID authority — this flag only gates production init.
   */
  passkeyConfigured: boolean;
  routing?: AthenaAuthHttpRouting;
  secret?: string;
  security: {
    bodyLimitBytes: number;
    cookieSecure: boolean | "auto";
    trustedOrigins: string[];
    trustedProxy: boolean;
  };
  session: Required<AthenaAuthSessionOptions>;
  social: NormalizedSocialAuthConfig;
  upstreamUrl?: string;
  url?: string;
  warnings: string[];
}

const DEFAULT_EMAIL_PASSWORD: Required<AthenaAuthEmailAndPasswordOptions> = {
  autoSignIn: true,
  enabled: true,
  maxPasswordLength: 128,
  minPasswordLength: 8,
  requireEmailVerification: false,
};

const DEFAULT_SESSION: Required<AthenaAuthSessionOptions> = {
  cookieName: "athena-auth.session-token",
  disableSessionRefresh: false,
  expiresInSeconds: 7 * 24 * 60 * 60,
  updateAgeSeconds: 24 * 60 * 60,
};

const DEFAULT_BRIDGE: NormalizedAthenaAuthBridgeConfig = {
  allowedOrigins: [],
  codeTtlSeconds: 30,
  enabled: false,
};

const BRIDGE_TTL_MIN = 5;
const BRIDGE_TTL_MAX = 300;

const DEFAULT_AUTHORIZATION_SERVER: NormalizedAthenaAuthorizationServerConfig =
{
  accessTokenTtlSeconds: 600,
  authorizationCodeTtlSeconds: 90,
  authorizationEndpoint: null,
  authorizationRequestTtlSeconds: 600,
  consentUrl: null,
  enabled: false,
  issuer: null,
  issueRefreshTokens: true,
  refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
  resources: {},
  signInUrl: null,
};

const AUTHORIZATION_TTL_LIMITS = {
  accessToken: { max: 3600, min: 60 },
  authorizationCode: { max: 600, min: 30 },
  authorizationRequest: { max: 15 * 60, min: 60 },
  refreshToken: { max: 365 * 24 * 60 * 60, min: 5 * 60 },
} as const;

const DEFAULT_PASSKEY: NormalizedAthenaAuthConfig["passkey"] = {
  authentication: normalizePasskeyAuthenticationPolicy(undefined),
  challengeTtlSeconds: 60,
  enabled: false,
  onboardingCreateSession: true,
  onboardingEnabled: false,
  origins: [],
  registration: normalizePasskeyRegistrationPolicy(undefined),
  relatedOrigins: [],
  rpId: null,
  rpName: null,
};

const PASSKEY_CHALLENGE_TTL_MIN = 1;
const PASSKEY_CHALLENGE_TTL_MAX = 600;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function originFromConfiguredUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return;
    }
    return url.origin;
  } catch {
    /* invalid URL */
  }
}

function mergeTrustedOrigins(
  explicit: readonly string[],
  passkeyOrigins: readonly string[],
  envOrigins: readonly string[],
): string[] {
  const unique = new Set<string>();
  for (const entry of [...explicit, ...passkeyOrigins, ...envOrigins]) {
    const trimmed = entry.trim().replace(/\/+$/, "");
    if (!trimmed) {
      continue;
    }
    const origin = originFromConfiguredUrl(trimmed);
    if (!origin) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        "Auth trusted origins must be absolute HTTP(S) URLs",
        "auth",
      );
    }
    unique.add(origin);
  }
  return [...unique];
}

function clampBridgeCodeTtl(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_BRIDGE.codeTtlSeconds;
  }
  const truncated = Math.trunc(value);
  if (truncated < BRIDGE_TTL_MIN) {
    return BRIDGE_TTL_MIN;
  }
  if (truncated > BRIDGE_TTL_MAX) {
    return BRIDGE_TTL_MAX;
  }
  return truncated;
}

function normalizeAllowedBridgeOrigins(value: unknown): string[] {
  const unique = new Set<string>();
  for (const entry of asStringList(value)) {
    try {
      unique.add(normalizeAuthBridgeDestinationOrigin(entry));
    } catch {
      // Fail closed: drop unparseable origins instead of enabling them.
    }
  }
  return [...unique];
}

function normalizeBoundedAuthorizationTtl(
  value: unknown,
  fallback: number,
  bounds: { max: number; min: number },
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(bounds.max, Math.max(bounds.min, Math.trunc(value)));
}

function normalizeConfiguredAuthorizationUrl(
  value: unknown,
  field: string,
): string | null {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `auth.authorizationServer.${field} must be an absolute HTTP(S) URL`,
      "auth",
    );
  }
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("invalid authorization URL");
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `auth.authorizationServer.${field} must be an absolute HTTP(S) URL without credentials, query, or fragment`,
      "auth",
    );
  }
}

function normalizeAuthorizationIssuer(
  value: unknown,
  appIdentity: AthenaAppIdentity | null,
  enabled: boolean,
): string | null {
  const configured = normalizeConfiguredAuthorizationUrl(value, "issuer");
  const issuer = configured ?? appIdentity?.origin ?? null;
  if (!enabled) {
    return issuer
      ? assertOriginOnlyIssuer(issuer, "auth.authorizationServer.issuer")
      : issuer;
  }
  if (!issuer) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "auth.authorizationServer.enabled requires issuer or app.url/APP_URL",
      "auth",
    );
  }
  const origin = assertOriginOnlyIssuer(
    issuer,
    "auth.authorizationServer.issuer",
  );
  if (process.env.NODE_ENV === "production" && !origin.startsWith("https://")) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "auth.authorizationServer.issuer must use HTTPS in production",
      "auth",
    );
  }
  return origin;
}

function normalizeAuthorizationResources(
  value: unknown,
): Readonly<Record<string, NormalizedAthenaAuthorizationServerResource>> {
  if (value === undefined) {
    return {};
  }
  const record = asRecord(value);
  if (!record) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      "auth.authorizationServer.resources must be a resource map",
      "auth",
    );
  }
  const resources: Record<string, NormalizedAthenaAuthorizationServerResource> =
    {};
  for (const [resource, rawResource] of Object.entries(record)) {
    let parsedResource: URL;
    try {
      parsedResource = new URL(resource);
      if (
        !parsedResource.protocol ||
        parsedResource.username ||
        parsedResource.password ||
        parsedResource.hash
      ) {
        throw new Error("invalid resource");
      }
    } catch {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        `auth.authorizationServer resource "${resource}" must be an absolute URI without credentials or fragment`,
        "auth",
      );
    }
    const resourceRecord = asRecord(rawResource);
    const rawScopes = resourceRecord?.scopes;
    const scopesRecord = asRecord(rawScopes);
    if (!scopesRecord || Object.keys(scopesRecord).length === 0) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        `auth.authorizationServer resource "${resource}" requires scopes`,
        "auth",
      );
    }
    const scopes: Record<string, { description?: string }> = {};
    for (const [scope, rawScope] of Object.entries(scopesRecord)) {
      if (!/^[\x21-\x7e]+$/.test(scope) || scope.includes(" ")) {
        throw new AthenaConfigurationError(
          "ATHENA_RUNTIME_CONFIG_INVALID",
          `auth.authorizationServer scope "${scope}" is invalid`,
          "auth",
        );
      }
      const scopeRecord = asRecord(rawScope);
      scopes[scope] = {
        ...(typeof scopeRecord?.description === "string"
          ? { description: scopeRecord.description }
          : {}),
      };
    }
    resources[parsedResource.toString().replace(/\/$/, "")] = {
      ...(typeof resourceRecord?.description === "string"
        ? { description: resourceRecord.description }
        : {}),
      scopes: Object.freeze(scopes),
    };
  }
  return Object.freeze(resources);
}

function normalizeAuthorizationServerConfig(
  rawValue: unknown,
  appIdentity: AthenaAppIdentity | null,
): NormalizedAthenaAuthorizationServerConfig {
  const raw = asRecord(rawValue);
  if (!raw) {
    return { ...DEFAULT_AUTHORIZATION_SERVER };
  }
  const enabled = raw.enabled === true;
  const issuer = normalizeAuthorizationIssuer(raw.issuer, appIdentity, enabled);
  return {
    accessTokenTtlSeconds: normalizeBoundedAuthorizationTtl(
      raw.accessTokenTtlSeconds,
      DEFAULT_AUTHORIZATION_SERVER.accessTokenTtlSeconds,
      AUTHORIZATION_TTL_LIMITS.accessToken,
    ),
    authorizationCodeTtlSeconds: normalizeBoundedAuthorizationTtl(
      raw.authorizationCodeTtlSeconds,
      DEFAULT_AUTHORIZATION_SERVER.authorizationCodeTtlSeconds,
      AUTHORIZATION_TTL_LIMITS.authorizationCode,
    ),
    authorizationEndpoint: normalizeConfiguredAuthorizationUrl(
      raw.authorizationEndpoint,
      "authorizationEndpoint",
    ),
    authorizationRequestTtlSeconds: normalizeBoundedAuthorizationTtl(
      raw.authorizationRequestTtlSeconds,
      DEFAULT_AUTHORIZATION_SERVER.authorizationRequestTtlSeconds,
      AUTHORIZATION_TTL_LIMITS.authorizationRequest,
    ),
    consentUrl: normalizeConfiguredAuthorizationUrl(
      raw.consentUrl,
      "consentUrl",
    ),
    enabled,
    issuer,
    issueRefreshTokens: raw.issueRefreshTokens !== false,
    refreshTokenTtlSeconds: normalizeBoundedAuthorizationTtl(
      raw.refreshTokenTtlSeconds,
      DEFAULT_AUTHORIZATION_SERVER.refreshTokenTtlSeconds,
      AUTHORIZATION_TTL_LIMITS.refreshToken,
    ),
    resources: normalizeAuthorizationResources(raw.resources),
    signInUrl: normalizeConfiguredAuthorizationUrl(raw.signInUrl, "signInUrl"),
  };
}

function normalizeBridgeConfig(
  rawBridge: unknown,
): NormalizedAthenaAuthBridgeConfig {
  const record = asRecord(rawBridge);
  if (!record) {
    return { ...DEFAULT_BRIDGE };
  }
  const allowedOrigins = normalizeAllowedBridgeOrigins(record.allowedOrigins);
  const explicitEnabled = record.enabled;
  const enabled =
    explicitEnabled === false
      ? false
      : explicitEnabled === true || allowedOrigins.length > 0;
  return {
    allowedOrigins,
    codeTtlSeconds: clampBridgeCodeTtl(record.codeTtlSeconds),
    enabled,
  };
}

function clampPasskeyChallengeTtl(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_PASSKEY.challengeTtlSeconds;
  }
  const truncated = Math.trunc(value);
  if (truncated < PASSKEY_CHALLENGE_TTL_MIN) {
    return PASSKEY_CHALLENGE_TTL_MIN;
  }
  if (truncated > PASSKEY_CHALLENGE_TTL_MAX) {
    return PASSKEY_CHALLENGE_TTL_MAX;
  }
  return truncated;
}

function normalizeOnboardingFlag(raw: unknown): {
  createSession: boolean;
  enabled: boolean;
} {
  if (raw === true) {
    return { createSession: true, enabled: true };
  }
  const onboarding = asRecord(raw);
  return {
    createSession: onboarding?.createSession !== false,
    enabled: onboarding?.enabled === true,
  };
}

function assertSocialConfigObject(key: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new AthenaConfigurationError(
      "ATHENA_RUNTIME_CONFIG_INVALID",
      `auth.${key} must be an object provider map`,
      "auth",
    );
  }
}

function normalizePasskeyConfig(
  rawPasskey: unknown,
): NormalizedAthenaAuthConfig["passkey"] {
  if (rawPasskey === true) {
    return {
      ...DEFAULT_PASSKEY,
      enabled: true,
      origins: [],
      relatedOrigins: [],
    };
  }
  const record = asRecord(rawPasskey);
  if (!record) {
    return { ...DEFAULT_PASSKEY, origins: [], relatedOrigins: [] };
  }
  const onboarding = normalizeOnboardingFlag(record.onboarding);
  const impliedEnabled = onboarding.enabled || record.enabled === true;
  return {
    authentication: normalizePasskeyAuthenticationPolicy(record.authentication),
    challengeTtlSeconds: clampPasskeyChallengeTtl(record.challengeTtlSeconds),
    enabled: impliedEnabled,
    onboardingCreateSession: onboarding.createSession,
    onboardingEnabled: onboarding.enabled,
    origins: mergeTrustedOrigins(asStringList(record.origins), [], []),
    registration: normalizePasskeyRegistrationPolicy(record.registration),
    relatedOrigins: mergeTrustedOrigins(
      asStringList(record.relatedOrigins),
      [],
      [],
    ),
    rpId: asString(record.rpId) ?? null,
    rpName: asString(record.rpName) ?? null,
  };
}

/** `createClient({ auth: false })` — Athena DB without Athena Auth. */
export function isAthenaAuthDisabled(input: unknown): input is false {
  return input === false;
}

/**
 * Object auth config only. `false` / non-objects normalize to `undefined`.
 */
export function athenaAuthConfig<T extends object>(
  input: false | T | null | undefined,
): T | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return;
  }
  return input;
}

function disabledAuthConfig(): NormalizedAthenaAuthConfig {
  return {
    appIdentity: null,
    autoMigrate: false,
    basePath: ATHENA_AUTH_DEFAULT_BASE_PATH,
    bridge: { ...DEFAULT_BRIDGE },
    authorizationServer: { ...DEFAULT_AUTHORIZATION_SERVER },
    emailAndPassword: { ...DEFAULT_EMAIL_PASSWORD, enabled: false },
    execution: "disabled",
    observability: normalizeAthenaAuthObservability(),
    organizationsEnabled: false,
    passkey: { ...DEFAULT_PASSKEY, origins: [], relatedOrigins: [] },
    passkeyConfigured: false,
    security: {
      bodyLimitBytes: 1_048_576,
      cookieSecure: "auto",
      trustedOrigins: [],
      trustedProxy: false,
    },
    session: { ...DEFAULT_SESSION },
    social: { providers: {} },
    warnings: [],
  };
}

/**
 * Collapse public / legacy auth config into one internal representation.
 * Call this once at the SDK boundary — do not re-branch on raw `auth.mode`.
 *
 * Precedence: `auth === false` → disabled. Explicit `mode` wins next.
 */
export interface NormalizeAthenaAuthConfigOptions {
  app?: AthenaAppIdentityInput;
  env?: Record<string, string | undefined>;
  identity?: AthenaAppIdentity | null;
}

export function normalizeAthenaAuthConfig(
  input?: unknown,
  options: NormalizeAthenaAuthConfigOptions = {},
): NormalizedAthenaAuthConfig {
  if (isAthenaAuthDisabled(input)) {
    return disabledAuthConfig();
  }
  const raw = asRecord(input) ?? {};
  const warnings: string[] = [];
  const explicitMode = asString(raw.mode);
  const execution: AthenaAuthExecutionMode =
    explicitMode === "local" ? "local" : "remote";

  if (
    execution === "remote" &&
    explicitMode === undefined &&
    (raw.routing !== undefined ||
      raw.url !== undefined ||
      raw.upstreamUrl !== undefined)
  ) {
    warnings.push(
      'Athena auth config without mode is treated as mode: "remote". ' +
      'Set auth.mode explicitly ("local" | "remote") when you can.',
    );
  }

  if (execution === "local" && (raw.url || raw.upstreamUrl || raw.routing)) {
    warnings.push(
      'auth.mode "local" ignores remote url / upstreamUrl / routing. ' +
      "Local requests terminate inside the application process.",
    );
  }

  const emailAndPassword = {
    ...DEFAULT_EMAIL_PASSWORD,
    ...(asRecord(raw.emailAndPassword) as
      | AthenaAuthEmailAndPasswordOptions
      | undefined),
  };
  const session = {
    ...DEFAULT_SESSION,
    ...(asRecord(raw.session) as AthenaAuthSessionOptions | undefined),
  };
  const securityRaw = asRecord(raw.security) ?? {};
  const organizations = asRecord(raw.organizations);
  const passkeyConfigured = Object.hasOwn(raw, "passkey");
  const passkey = normalizePasskeyConfig(raw.passkey);
  assertSocialConfigObject("social", raw.social);
  assertSocialConfigObject("oauth", raw.oauth);
  assertSocialConfigObject("socialProviders", raw.socialProviders);
  if (raw.oauth != null) {
    warnings.push(
      "auth.oauth is deprecated; configure auth.social.providers instead.",
    );
  }
  const social: NormalizedSocialAuthConfig = normalizeAuthSocialProviders(raw);
  const envForIdentity = options.env ?? process.env;
  const appIdentity =
    options.identity === undefined
      ? resolveAthenaAppIdentity({
        app: options.app,
        env: envForIdentity,
        required: false,
      })
      : options.identity;
  const identityOrigins = appIdentity ? [appIdentity.origin] : [];
  const explicitTrustedOrigins = Array.isArray(securityRaw.trustedOrigins)
    ? securityRaw.trustedOrigins.filter(
      (value): value is string => typeof value === "string",
    )
    : [];

  return {
    appIdentity,
    autoMigrate: raw.autoMigrate === true,
    basePath: asString(raw.basePath) ?? ATHENA_AUTH_DEFAULT_BASE_PATH,
    bridge: normalizeBridgeConfig(raw.bridge),
    authorizationServer: normalizeAuthorizationServerConfig(
      raw.authorizationServer,
      appIdentity,
    ),
    emailAndPassword: {
      autoSignIn: emailAndPassword.autoSignIn !== false,
      enabled: emailAndPassword.enabled !== false,
      maxPasswordLength: emailAndPassword.maxPasswordLength ?? 128,
      minPasswordLength: emailAndPassword.minPasswordLength ?? 8,
      requireEmailVerification:
        emailAndPassword.requireEmailVerification === true,
    },
    execution,
    observability: normalizeAthenaAuthObservability(
      asRecord(raw.observability) as AthenaAuthObservabilityConfig | undefined,
    ),
    organizationsEnabled: organizations?.enabled !== false,
    passkey,
    passkeyConfigured,
    routing:
      execution === "local"
        ? "same-origin"
        : (asString(raw.routing) as AthenaAuthHttpRouting | undefined),
    secret: asString(raw.secret),
    security: {
      bodyLimitBytes:
        typeof securityRaw.bodyLimitBytes === "number"
          ? securityRaw.bodyLimitBytes
          : 1_048_576,
      cookieSecure:
        securityRaw.cookieSecure === false ||
          securityRaw.cookieSecure === true ||
          securityRaw.cookieSecure === "auto"
          ? securityRaw.cookieSecure
          : "auto",
      trustedOrigins: mergeTrustedOrigins(
        explicitTrustedOrigins,
        passkey.origins,
        identityOrigins,
      ),
      trustedProxy: securityRaw.trustedProxy === true,
    },
    session: {
      cookieName: session.cookieName || DEFAULT_SESSION.cookieName,
      disableSessionRefresh: session.disableSessionRefresh === true,
      expiresInSeconds:
        session.expiresInSeconds ?? DEFAULT_SESSION.expiresInSeconds,
      updateAgeSeconds:
        session.updateAgeSeconds ?? DEFAULT_SESSION.updateAgeSeconds,
    },
    social,
    upstreamUrl: asString(raw.upstreamUrl),
    url: asString(raw.url),
    warnings,
  };
}

export function isLocalAthenaAuthConfig(input?: unknown): boolean {
  return normalizeAthenaAuthConfig(input).execution === "local";
}

export function isDisabledAthenaAuthConfig(input?: unknown): boolean {
  return normalizeAthenaAuthConfig(input).execution === "disabled";
}
