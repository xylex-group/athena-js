import type { AthenaPasskeyHint } from "../../types.ts";
import { formatPasskeyDiscoverabilityDiagnostic } from "./diagnostic.ts";
import {
  type PasskeyBrowserOptionsInput,
  type PasskeyBrowserRpIdFallback,
  toPublicKeyCredentialCreationOptions,
  toPublicKeyCredentialRequestOptions,
} from "./options.ts";

export {
  serializeAssertedPasskey,
  serializeCreatedPasskey,
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
    return;
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
  const extensions = asRecord(
    payload.extensions
  ) as AuthenticationExtensionsClientInputs | null;
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

let activeCredentialRequest:
  | {
      controller: AbortController;
      settled: Promise<void>;
    }
  | undefined;

function createAbortError(cause?: unknown): Error {
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  if (cause !== undefined) {
    Object.assign(error, { cause });
  }
  return error;
}

export function isAlreadyPendingWebAuthnError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const name = "name" in error ? String(error.name) : "";
  const message = "message" in error ? String(error.message).toLowerCase() : "";
  return (
    message.includes("request is already pending") ||
    (name === "InvalidStateError" && message.includes("pending"))
  );
}

export function resetWebAuthnCeremonyLockForTests(): void {
  activeCredentialRequest = undefined;
}

/**
 * At most one navigator.credentials.create/get may be owned in this browsing
 * context. Aborting the prior signal is not enough; the previous promise must
 * settle before the next native ceremony starts.
 */
async function withExclusiveWebAuthnCeremony<T>(
  callerSignal: AbortSignal | undefined,
  operate: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const previous = activeCredentialRequest;
  previous?.controller.abort();
  if (previous) {
    await previous.settled;
  }

  if (callerSignal?.aborted) {
    throw createAbortError();
  }

  const controller = new AbortController();
  const onCallerAbort = (): void => {
    controller.abort();
  };
  callerSignal?.addEventListener("abort", onCallerAbort);

  let settle = (): void => undefined;
  const settled = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const owned = { controller, settled };
  activeCredentialRequest = owned;

  try {
    return await operate(controller.signal);
  } catch (error) {
    if (isAlreadyPendingWebAuthnError(error)) {
      throw createAbortError(error);
    }
    throw error;
  } finally {
    callerSignal?.removeEventListener("abort", onCallerAbort);
    settle();
    if (activeCredentialRequest === owned) {
      activeCredentialRequest = undefined;
    }
  }
}

export async function createPasskeyCredential(
  publicKey: PasskeyCreationOptionsWithHints,
  signal?: AbortSignal
): Promise<Credential | null> {
  ensureBrowserWebAuthn("passkey.register");
  return withExclusiveWebAuthnCeremony(signal, (ownedSignal) =>
    navigator.credentials.create({
      publicKey,
      signal: ownedSignal,
    })
  );
}

export async function getPasskeyCredential(
  publicKey: PublicKeyCredentialRequestOptions,
  mediation?: CredentialMediationRequirement,
  signal?: AbortSignal
): Promise<Credential | null> {
  ensureBrowserWebAuthn("passkey.signIn");
  return withExclusiveWebAuthnCeremony(signal, (ownedSignal) =>
    navigator.credentials.get({
      ...(mediation ? { mediation } : {}),
      publicKey,
      signal: ownedSignal,
    })
  );
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
