import { AthenaConfigurationError } from "../../../config/errors.ts";
import type { AthenaAppIdentity } from "../../app-identity.ts";
import type { NormalizedAthenaAuthConfig } from "../../config.ts";
import type { AthenaPasskeyRelyingParty } from "./types.ts";

/**
 * Trusted RP snapshot source (INV-PK-09).
 * Never arbitrary Host / x-forwarded-host.
 */
export interface PasskeyRelyingPartyResolver {
  resolve(): AthenaPasskeyRelyingParty;
}

export const ATHENA_PASSKEY_DEFAULT_RP_NAME = "Athena";

export const ATHENA_PASSKEY_DEV_DEFAULT_ORIGINS = Object.freeze([
  "http://localhost",
  "http://localhost:3000",
  "http://127.0.0.1",
  "http://127.0.0.1:3000",
] as const);

const EMPTY_RELATED_ORIGINS: readonly string[] = Object.freeze([]);

export const ATHENA_PASSKEY_DEV_DEFAULT_RELYING_PARTY: AthenaPasskeyRelyingParty =
  Object.freeze({
    id: "localhost",
    name: ATHENA_PASSKEY_DEFAULT_RP_NAME,
    origins: ATHENA_PASSKEY_DEV_DEFAULT_ORIGINS,
    relatedOrigins: EMPTY_RELATED_ORIGINS,
  });

export interface PasskeyRelyingPartySnapshotInput {
  appIdentity?: AthenaAppIdentity | null;
  environment: "production" | "development";
  passkey: Pick<
    NormalizedAthenaAuthConfig["passkey"],
    "origins" | "relatedOrigins" | "rpId" | "rpName"
  >;
  /** Production + passkeys + no origin uses ATHENA_PASSKEY_APP_ORIGIN_REQUIRED. */
  required?: boolean;
  trustedOrigins: readonly string[];
}

function passkeyRpConfigError(
  message: string,
  code:
    | "ATHENA_RUNTIME_CONFIG_INVALID"
    | "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED"
    | "ATHENA_PASSKEY_RP_AMBIGUOUS" = "ATHENA_RUNTIME_CONFIG_INVALID"
): AthenaConfigurationError {
  return new AthenaConfigurationError(code, message, "auth");
}

function isExactAbsoluteOrigin(value: string): boolean {
  if (value.length === 0 || value.includes("*")) {
    return false;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    if (!url.hostname || url.hostname.includes("*")) {
      return false;
    }
    return value === url.origin || value === `${url.origin}/`;
  } catch {
    return false;
  }
}

function assertExactOrigins(origins: readonly string[]): void {
  for (const origin of origins) {
    if (!isExactAbsoluteOrigin(origin)) {
      throw passkeyRpConfigError(
        "Passkey origins must be exact absolute origins (no wildcards, empty members, or relative hosts)."
      );
    }
  }
}

function uniqueTrustedHostname(
  trustedOrigins: readonly string[]
): string | null {
  if (trustedOrigins.length === 0) {
    return null;
  }
  const hosts = new Set<string>();
  for (const origin of trustedOrigins) {
    if (!isExactAbsoluteOrigin(origin)) {
      return null;
    }
    hosts.add(new URL(origin).hostname);
  }
  if (hosts.size !== 1) {
    return null;
  }
  const [hostname] = hosts;
  return hostname ?? null;
}

function trimmedNonEmpty(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Freeze one immutable domain RP at Auth init.
 * Precedence: explicit passkey origins / app identity → unique-host
 * trustedOrigins for rpId only → documented localhost/dev defaults
 * (non-production only). Trusted origins never become ceremony origins.
 */
export function createPasskeyRelyingPartySnapshot(
  input: PasskeyRelyingPartySnapshotInput
): AthenaPasskeyRelyingParty {
  const { appIdentity, environment, passkey, required, trustedOrigins } = input;
  const explicitOrigins = passkey.origins;
  const explicitRelated = passkey.relatedOrigins;

  if (explicitOrigins.length > 0) {
    assertExactOrigins(explicitOrigins);
  }
  if (explicitRelated.length > 0) {
    assertExactOrigins(explicitRelated);
  }

  let id = trimmedNonEmpty(passkey.rpId);
  let name =
    trimmedNonEmpty(passkey.rpName) ?? trimmedNonEmpty(appIdentity?.name);
  let origins: readonly string[] =
    explicitOrigins.length > 0
      ? explicitOrigins
      : appIdentity
        ? [appIdentity.origin]
        : [];
  const relatedOrigins: readonly string[] =
    explicitRelated.length > 0 ? explicitRelated : [];

  if (!id && appIdentity) {
    id = appIdentity.hostname;
  }
  if (!id && origins.length > 0) {
    const hosts = new Set<string>();
    for (const origin of origins) {
      if (isExactAbsoluteOrigin(origin)) {
        hosts.add(new URL(origin).hostname);
      }
    }
    if (hosts.size === 1) {
      const [hostname] = hosts;
      id = hostname ?? undefined;
    } else if (hosts.size > 1) {
      throw passkeyRpConfigError(
        "Passkey relying party is ambiguous: multiple WebAuthn hostnames require an explicit passkey.rpId.",
        "ATHENA_PASSKEY_RP_AMBIGUOUS"
      );
    }
  }
  if (!id) {
    const trustedHost = uniqueTrustedHostname(trustedOrigins);
    if (trustedHost) {
      id = trustedHost;
    }
  }
  if (!name) {
    name = ATHENA_PASSKEY_DEFAULT_RP_NAME;
  }

  if (!id) {
    if (environment === "production") {
      throw passkeyRpConfigError(
        required
          ? "Passkeys require a trusted application origin (createClient app.url or APP_URL). Production does not default to localhost."
          : "Passkey relying party requires a trusted rpId (explicit passkey.rpId or a unique hostname in security.trustedOrigins). Production does not default to localhost.",
        required
          ? "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED"
          : "ATHENA_RUNTIME_CONFIG_INVALID"
      );
    }
    id = "localhost";
  }

  if (origins.length === 0) {
    if (environment === "production") {
      throw passkeyRpConfigError(
        required
          ? "Passkeys require a trusted application origin (createClient app.url or APP_URL)."
          : "Passkey relying party requires at least one exact origin in production.",
        required
          ? "ATHENA_PASSKEY_APP_ORIGIN_REQUIRED"
          : "ATHENA_RUNTIME_CONFIG_INVALID"
      );
    }
    origins = ATHENA_PASSKEY_DEV_DEFAULT_ORIGINS;
  }

  assertExactOrigins(origins);
  if (relatedOrigins.length > 0) {
    assertExactOrigins(relatedOrigins);
  }

  const frozenOrigins = Object.freeze([...origins]);
  const frozenRelated = Object.freeze([...relatedOrigins]);
  return Object.freeze({
    id,
    name,
    origins: frozenOrigins,
    relatedOrigins: frozenRelated,
  });
}

export function createPasskeyRelyingPartyResolver(
  snapshot: AthenaPasskeyRelyingParty
): PasskeyRelyingPartyResolver {
  return {
    resolve() {
      return snapshot;
    },
  };
}
