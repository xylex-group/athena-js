/**
 * Process-init application identity (origin + hostname).
 *
 * Never derived from Host / x-forwarded-host / Origin request headers.
 * APP_URL (and documented aliases) plus optional createClient({ app })
 * are the only URL sources.
 */

import { AthenaConfigurationError } from "../config/errors.ts";
import { ATHENA_ENV_APP_URL_KEYS } from "../env/index.ts";

export interface AthenaAppIdentityInput {
  id?: string | null;
  name?: string | null;
  url?: string | null;
}

export interface AthenaAppIdentity {
  readonly hostname: string;
  readonly name: string;
  readonly origin: string;
}

export interface ResolveAthenaAppIdentityOptions {
  app?: AthenaAppIdentityInput;
  env?: Record<string, string | undefined>;
  environment?: "development" | "production";
  /** When true, production missing URL fails closed. */
  required?: boolean;
}

const FORBIDDEN_IDENTITY_ENV_KEYS = new Set([
  "HOST",
  "HTTP_HOST",
  "X_FORWARDED_HOST",
  "x-forwarded-host",
]);

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

function firstConfiguredOrigin(
  env: Record<string, string | undefined>
): string | undefined {
  for (const key of ATHENA_ENV_APP_URL_KEYS) {
    const raw = env[key];
    if (typeof raw !== "string" || !raw.trim()) {
      continue;
    }
    const origin = originFromConfiguredUrl(raw);
    if (origin) {
      return origin;
    }
  }
}

/**
 * Resolve one immutable app identity at Auth / client init.
 */
export function resolveAthenaAppIdentity(
  options: ResolveAthenaAppIdentityOptions = {}
): AthenaAppIdentity | null {
  const env = options.env ?? {};
  for (const key of FORBIDDEN_IDENTITY_ENV_KEYS) {
    void env[key];
  }

  const explicitUrl =
    typeof options.app?.url === "string" ? options.app.url.trim() : "";
  let origin: string | undefined;
  if (explicitUrl) {
    origin = originFromConfiguredUrl(explicitUrl);
    if (!origin) {
      throw new AthenaConfigurationError(
        "ATHENA_RUNTIME_CONFIG_INVALID",
        "createClient({ app: { url } }) must be an absolute http(s) URL.",
        "auth"
      );
    }
  } else {
    origin = firstConfiguredOrigin(env);
  }

  if (!origin) {
    if (options.required && options.environment === "production") {
      throw new AthenaConfigurationError(
        "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED",
        "Passkeys require a trusted application origin (createClient app.url or APP_URL). Production does not default to localhost and never reads Host.",
        "auth"
      );
    }
    return null;
  }

  const hostname = new URL(origin).hostname;
  const name =
    typeof options.app?.name === "string" && options.app.name.trim()
      ? options.app.name.trim()
      : "Athena";
  return Object.freeze({ hostname, name, origin });
}
