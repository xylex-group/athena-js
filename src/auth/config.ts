/**
 * Normalized Athena Auth execution + HTTP routing.
 *
 * Execution (`disabled` | `local` | `remote`) is distinct from HTTP routing
 * (`same-origin` | `direct` | `custom`). `auth: false` is disabled. Legacy
 * object configs without `mode` normalize to `remote`.
 */

import { ATHENA_AUTH_DEFAULT_BASE_PATH } from "./contract/index.ts";

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

export interface AthenaAuthLocalConfig {
  /**
   * Explicit opt-in only. `createClient()` never auto-migrates production
   * Auth schema unless this is `true`.
   */
  autoMigrate?: boolean;
  basePath?: string;
  emailAndPassword?: AthenaAuthEmailAndPasswordOptions;
  mode: "local";
  organizations?: { enabled?: boolean };
  secret?: string;
  security?: AthenaAuthSecurityOptions;
  session?: AthenaAuthSessionOptions;
}

export interface AthenaAuthRemoteConfig {
  credentials?: RequestCredentials;
  mode?: "remote";
  routing?: AthenaAuthHttpRouting;
  secret?: string;
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
  autoMigrate: boolean;
  basePath: string;
  emailAndPassword: Required<AthenaAuthEmailAndPasswordOptions>;
  execution: AthenaAuthExecutionMode;
  organizationsEnabled: boolean;
  routing?: AthenaAuthHttpRouting;
  secret?: string;
  security: {
    bodyLimitBytes: number;
    cookieSecure: boolean | "auto";
    trustedOrigins: string[];
    trustedProxy: boolean;
  };
  session: Required<AthenaAuthSessionOptions>;
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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `createClient({ auth: false })` — Athena DB without Athena Auth. */
export function isAthenaAuthDisabled(input: unknown): input is false {
  return input === false;
}

/**
 * Object auth config only. `false` / non-objects normalize to `undefined`.
 */
export function athenaAuthConfig<T extends object>(
  input: false | T | null | undefined
): T | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  return input;
}

function disabledAuthConfig(): NormalizedAthenaAuthConfig {
  return {
    autoMigrate: false,
    basePath: ATHENA_AUTH_DEFAULT_BASE_PATH,
    emailAndPassword: { ...DEFAULT_EMAIL_PASSWORD, enabled: false },
    execution: "disabled",
    organizationsEnabled: false,
    security: {
      bodyLimitBytes: 1_048_576,
      cookieSecure: "auto",
      trustedOrigins: [],
      trustedProxy: false,
    },
    session: { ...DEFAULT_SESSION },
    warnings: [],
  };
}

/**
 * Collapse public / legacy auth config into one internal representation.
 * Call this once at the SDK boundary — do not re-branch on raw `auth.mode`.
 *
 * Precedence: `auth === false` → disabled. Explicit `mode` wins next.
 */
export function normalizeAthenaAuthConfig(
  input?: AthenaAuthInput
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
    (raw.routing !== undefined || raw.url !== undefined || raw.upstreamUrl !== undefined)
  ) {
    warnings.push(
      'Athena auth config without mode is treated as mode: "remote". ' +
        'Set auth.mode explicitly ("local" | "remote") when you can.'
    );
  }

  if (execution === "local" && (raw.url || raw.upstreamUrl || raw.routing)) {
    warnings.push(
      'auth.mode "local" ignores remote url / upstreamUrl / routing. ' +
        "Local requests terminate inside the application process."
    );
  }

  const emailAndPassword = {
    ...DEFAULT_EMAIL_PASSWORD,
    ...(asRecord(raw.emailAndPassword) as AthenaAuthEmailAndPasswordOptions | undefined),
  };
  const session = {
    ...DEFAULT_SESSION,
    ...(asRecord(raw.session) as AthenaAuthSessionOptions | undefined),
  };
  const securityRaw = asRecord(raw.security) ?? {};
  const organizations = asRecord(raw.organizations);

  return {
    autoMigrate: raw.autoMigrate === true,
    basePath: asString(raw.basePath) ?? ATHENA_AUTH_DEFAULT_BASE_PATH,
    emailAndPassword: {
      autoSignIn: emailAndPassword.autoSignIn !== false,
      enabled: emailAndPassword.enabled !== false,
      maxPasswordLength: emailAndPassword.maxPasswordLength ?? 128,
      minPasswordLength: emailAndPassword.minPasswordLength ?? 8,
      requireEmailVerification:
        emailAndPassword.requireEmailVerification === true,
    },
    execution,
    organizationsEnabled: organizations?.enabled !== false,
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
      trustedOrigins: Array.isArray(securityRaw.trustedOrigins)
        ? securityRaw.trustedOrigins.filter(
            (value): value is string => typeof value === "string"
          )
        : [],
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
    upstreamUrl: asString(raw.upstreamUrl),
    url: asString(raw.url),
    warnings,
  };
}

export function isLocalAthenaAuthConfig(input?: AthenaAuthInput): boolean {
  return normalizeAthenaAuthConfig(input).execution === "local";
}

export function isDisabledAthenaAuthConfig(input?: AthenaAuthInput): boolean {
  return normalizeAthenaAuthConfig(input).execution === "disabled";
}
