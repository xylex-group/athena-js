import { sha256HexUtf8 } from "../../node-crypto.ts";
import {
  ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
  AthenaBillingCredentialError,
} from "../errors.ts";
import type { BillingProviderName } from "../types.ts";
import type { BillingEnvironmentName } from "./environment.ts";
import { billingEnvironmentName } from "./environment.ts";

export type BillingCredentialEnvironment = BillingEnvironmentName;

export type BillingCredentialClass = "api_key" | "access_token";

export type BillingCredentialKind =
  | "api_key"
  | "secret_key"
  | "restricted_key"
  | "advanced_access_token"
  | "organization_access_token"
  | "oauth_access_token";

const REDACTED = "[REDACTED]";

export class BillingSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  revealForProviderRuntime(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  valueOf(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

export interface BillingStoredCredential {
  readonly kind: BillingCredentialKind;
  readonly secret: BillingSecret;
}

export interface BillingEnvironmentCredentials<TCredential> {
  readonly live?: TCredential;
  readonly test?: TCredential;
}

export interface BillingProviderBindingCredentials {
  readonly live?: BillingStoredCredential;
  readonly test?: BillingStoredCredential;
}

export interface BillingCredentialBinding {
  readonly credentials: BillingProviderBindingCredentials;
  readonly kind: "configured" | "connection";
  readonly provider: BillingProviderName;
}

export interface BillingResolvedCredential {
  readonly environment: BillingCredentialEnvironment;
  /** SHA-256 hex of the secret. Never the plaintext secret. */
  readonly fingerprint: string;
  readonly kind: BillingCredentialKind;
  readonly provider: BillingProviderName;
  /** Configured provider vs connection `credential_reference`. */
  readonly slot: string;
  revealForProviderRuntime(): string;
}

export interface BillingCredentialSelection {
  readonly credential: BillingResolvedCredential;
  readonly credentialKind: BillingCredentialKind;
  readonly environment: BillingCredentialEnvironment;
  readonly provider: BillingProviderName;
  readonly testMode: boolean;
}

export type BillingCredentialEnvironmentInference = "test" | "live" | "unknown";

export function credentialClassForKind(
  kind: BillingCredentialKind
): BillingCredentialClass {
  return kind === "advanced_access_token" ||
    kind === "organization_access_token" ||
    kind === "oauth_access_token"
    ? "access_token"
    : "api_key";
}

export function availableBillingCredentialEnvironments(
  credentials: BillingProviderBindingCredentials
): BillingCredentialEnvironment[] {
  const available: BillingCredentialEnvironment[] = [];
  if (credentials.test != null) {
    available.push("test");
  }
  if (credentials.live != null) {
    available.push("live");
  }
  return available;
}

export function billingCredentialFingerprint(secret: string): string {
  return sha256HexUtf8(secret);
}

export function billingCredentialSlot(input: {
  credentialReference?: string;
  kind: "configured" | "connection";
}): string {
  if (input.kind === "configured") {
    return "configured";
  }
  const reference = input.credentialReference?.trim();
  return reference != null && reference.length > 0
    ? reference
    : "connection";
}

export function resolveBillingCredential(input: {
  binding: BillingCredentialBinding;
  provider: BillingProviderName;
  slot?: string;
  testMode: boolean;
}): BillingCredentialSelection {
  const environment = billingEnvironmentName(input.testMode);
  const stored = input.binding.credentials[environment];
  if (stored == null) {
    const available = availableBillingCredentialEnvironments(
      input.binding.credentials
    );
    throw new AthenaBillingCredentialError({
      code: ATHENA_BILLING_CREDENTIAL_UNAVAILABLE,
      environment,
      message: `${formatProviderLabel(input.provider)} ${environment} billing credential is unavailable. Configured environments: ${available.length > 0 ? available.join(", ") : "none"}.`,
      provider: input.provider,
    });
  }
  const secret = stored.secret.revealForProviderRuntime();
  const slot =
    input.slot != null && input.slot.trim() !== ""
      ? input.slot.trim()
      : billingCredentialSlot({ kind: input.binding.kind });
  const credential: BillingResolvedCredential = {
    environment,
    fingerprint: billingCredentialFingerprint(secret),
    kind: stored.kind,
    provider: input.provider,
    slot,
    revealForProviderRuntime: () => stored.secret.revealForProviderRuntime(),
  };
  return {
    credential,
    credentialKind: stored.kind,
    environment,
    provider: input.provider,
    testMode: input.testMode,
  };
}

function formatProviderLabel(provider: BillingProviderName): string {
  if (provider.length === 0) {
    return "Billing";
  }
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}
