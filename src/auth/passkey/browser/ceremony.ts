import type { AthenaPasskeyHint } from "../../types.ts";
import { formatPasskeyDiscoverabilityDiagnostic } from "./diagnostic.ts";
import {
  toPublicKeyCredentialCreationOptions,
  toPublicKeyCredentialRequestOptions,
  type PasskeyBrowserOptionsInput,
  type PasskeyBrowserRpIdFallback,
} from "./options.ts";
import {
  serializeAuthenticationCredential,
  serializeRegistrationCredential,
} from "./serialize.ts";

export type PasskeyCreationOptionsWithHints =
  PublicKeyCredentialCreationOptions & {
    hints?: string[];
  };

type RecordLike = Record<string, unknown>;

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as RecordLike;
}

function ensureBrowserWebAuthn(flow: string): void {
  const nav =
    typeof globalThis === "object"
      ? (globalThis as { navigator?: { credentials?: unknown } }).navigator
      : undefined;
  const hasPublicKey =
    typeof globalThis === "object" &&
    "PublicKeyCredential" in globalThis &&
    typeof (globalThis as { PublicKeyCredential?: unknown })
      .PublicKeyCredential !== "undefined";
  const hasWindow =
    typeof globalThis === "object" &&
    "window" in globalThis &&
    (globalThis as { window?: unknown }).window != null;
  if (!(hasWindow && nav?.credentials && hasPublicKey)) {
    throw new Error(`${flow} requires a browser with WebAuthn support`);
  }
}

function asHints(value: unknown): AthenaPasskeyHint[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const hints = value.filter(
    (entry): entry is AthenaPasskeyHint =>
      entry === "client-device" ||
      entry === "security-key" ||
      entry === "hybrid"
  );
  return hints.length > 0 ? hints : undefined;
}

/**
 * Apply caller preferences. Hints are a UI steer. authenticatorAttachment is
 * only copied when the caller opted into an eligibility filter.
 */
export function applyPasskeyRegistrationOverrides(
  options: PasskeyCreationOptionsWithHints,
  payload: RecordLike | undefined
): PasskeyCreationOptionsWithHints {
  if (!payload) {
    return options;
  }
  const authenticatorAttachment = payload.authenticatorAttachment;
  const hints = asHints(payload.hints);
  const extensions = asRecord(payload.extensions) as
    | AuthenticationExtensionsClientInputs
    | null;
  const next: PasskeyCreationOptionsWithHints = {
    ...options,
    extensions: extensions
      ? {
          ...(options.extensions ?? {}),
          ...extensions,
        }
      : options.extensions,
  };
  if (hints) {
    next.hints = hints;
  }
  if (
    authenticatorAttachment === "platform" ||
    authenticatorAttachment === "cross-platform"
  ) {
    next.authenticatorSelection = {
      ...(options.authenticatorSelection ?? {}),
      authenticatorAttachment,
    };
  }
  return next;
}

export async function createPasskeyCredential(
  publicKey: PasskeyCreationOptionsWithHints,
  signal?: AbortSignal
): Promise<Credential | null> {
  ensureBrowserWebAuthn("passkey.register");
  return navigator.credentials.create({
    publicKey,
    ...(signal ? { signal } : {}),
  });
}

export async function getPasskeyCredential(
  publicKey: PublicKeyCredentialRequestOptions,
  mediation?: CredentialMediationRequirement,
  signal?: AbortSignal
): Promise<Credential | null> {
  ensureBrowserWebAuthn("passkey.signIn");
  return navigator.credentials.get({
    ...(mediation ? { mediation } : {}),
    ...(signal ? { signal } : {}),
    publicKey,
  });
}

export function creationOptionsFromWire(
  options: PasskeyBrowserOptionsInput | RecordLike,
  payload?: RecordLike,
  fallback?: PasskeyBrowserRpIdFallback
): PasskeyCreationOptionsWithHints {
  const mapped = toPublicKeyCredentialCreationOptions(
    options,
    fallback
  ) as PasskeyCreationOptionsWithHints;
  const hints = asHints((options as RecordLike).hints);
  if (hints) {
    mapped.hints = hints;
  }
  return applyPasskeyRegistrationOverrides(mapped, payload);
}

export function requestOptionsFromWire(
  options: PasskeyBrowserOptionsInput | RecordLike,
  fallback?: PasskeyBrowserRpIdFallback
): PublicKeyCredentialRequestOptions {
  return toPublicKeyCredentialRequestOptions(options, fallback);
}

export function serializeCreatedPasskey(credential: unknown): string {
  return JSON.stringify(serializeRegistrationCredential(credential));
}

export function serializeAssertedPasskey(credential: unknown): string {
  return JSON.stringify(serializeAuthenticationCredential(credential));
}

export function noAssertionDiagnostic(input: {
  allowCredentialsCount: number;
  residentKey: boolean | null | undefined;
}): string {
  return (
    formatPasskeyDiscoverabilityDiagnostic({
      allowCredentialsCount: input.allowCredentialsCount,
      assertionPresent: false,
      residentKey: input.residentKey,
    }) ?? "browser returned no assertion"
  );
}
