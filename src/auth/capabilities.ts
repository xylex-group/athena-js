/**
 * Status-aware auth capabilities (INV-P).
 *
 * Lookup failure must never be treated as "all features disabled".
 * UI may hide/disable only when `status === "known"` and the field is false,
 * or when the app sets an explicit features override.
 */

import { deriveEmbeddedCapabilityAdvertisement } from "./contract/operations.ts";
import { ATHENA_AUTH_OPERATIONS } from "./contract/operations.generated.ts";

export type AthenaAuthCapabilitiesStatus = "known" | "partial" | "unknown";

export type AthenaAuthCapabilitiesSource =
  | "bootstrap"
  | "http"
  | "client-config"
  | "fallback";

export interface AthenaAuthPasskeyCapabilityDetail {
  authentication?: boolean | null;
  conditionalUi?: boolean | null;
  enabled?: boolean | null;
  management?: boolean | null;
  onboarding?: boolean | null;
  registration?: boolean | null;
}

export interface AthenaAuthCapabilitiesFeatures {
  password?: boolean | null;
  organizations?: boolean | null;
  /**
   * Broad passkey capability. Unknown is not disabled.
   * Detail flags live on `passkey` and must not replace this boolean.
   */
  passkeys?: boolean | null;
  passkey?: AthenaAuthPasskeyCapabilityDetail | null;
  sessions?: boolean | null;
  social?: {
    providers?: string[] | null;
  } | null;
  emailAndPassword?: boolean | null;
}

export interface AthenaAuthCapabilitiesResult extends AthenaAuthCapabilitiesFeatures {
  status: AthenaAuthCapabilitiesStatus;
  fetchedAt?: number;
  source: AthenaAuthCapabilitiesSource;
}

export interface AthenaAuthCapabilitiesStore {
  get(): AthenaAuthCapabilitiesResult;
  /** Alias of `get()` — one snapshot owner (INV-P / R11). */
  getSnapshot(): AthenaAuthCapabilitiesResult;
  set(next: AthenaAuthCapabilitiesResult): void;
  /** Merge fields; elevates/downgrades status conservatively. */
  merge(
    patch: Partial<AthenaAuthCapabilitiesFeatures>,
    meta?: {
      status?: AthenaAuthCapabilitiesStatus;
      source?: AthenaAuthCapabilitiesSource;
    }
  ): AthenaAuthCapabilitiesResult;
  /** Mark transport failure without disabling features (INV-P). */
  markUnknown(source?: AthenaAuthCapabilitiesSource): AthenaAuthCapabilitiesResult;
  /**
   * First-paint seed. No-op unless the store is still `unknown`.
   * Returns whether the snapshot was applied.
   */
  hydrate(next: AthenaAuthCapabilitiesResult): boolean;
  subscribe(listener: (value: AthenaAuthCapabilitiesResult) => void): () => void;
}

const EMPTY_UNKNOWN: AthenaAuthCapabilitiesResult = {
  status: "unknown",
  source: "fallback",
};

export interface CreateEmbeddedCapabilitySnapshotOptions {
  /**
   * Operator intent (`auth.passkey.enabled`). Implementation support is
   * derived from the operation catalog; this flag is runtime enablement.
   */
  passkeyEnabled?: boolean;
  /** Passkey-first onboarding. Never inferred from `passkeys === true`. */
  passkeyOnboarding?: boolean;
  /**
   * Configured served social provider ids. Advertised only after the
   * social HTTP operations are catalog `embedded: "supported"`.
   */
  socialProviders?: readonly string[];
}

/**
 * Embedded Auth advertisement.
 *
 * `deriveEmbeddedCapabilityAdvertisement` is implementation support (HTTP
 * routes exist). Advertised `passkeys` is support AND this runtime's
 * `auth.passkey.enabled`. Default config is disabled, so the frozen snapshot
 * is `passkeys: false`.
 */
export function createEmbeddedCapabilitySnapshot(
  options: CreateEmbeddedCapabilitySnapshotOptions = {},
): AthenaAuthCapabilitiesResult {
  const implementation = deriveEmbeddedCapabilityAdvertisement(
    ATHENA_AUTH_OPERATIONS,
  );
  const enabled = implementation.passkeys && options.passkeyEnabled === true;
  return {
    emailAndPassword: true,
    organizations: true,
    passkey: {
      authentication: enabled,
      conditionalUi: enabled,
      enabled,
      management: enabled,
      onboarding: enabled && options.passkeyOnboarding === true,
      registration: enabled,
    },
    passkeys: enabled,
    password: true,
    sessions: true,
    social: {
      providers: implementation.socialProvidersAdvertised
        ? [...(options.socialProviders ?? [])]
        : [],
    },
    source: "bootstrap",
    status: "known",
  };
}

/** Default advertisement: implementation support, operator passkeys off. */
export const ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT: AthenaAuthCapabilitiesResult =
  createEmbeddedCapabilitySnapshot();

function pickStatus(
  current: AthenaAuthCapabilitiesStatus,
  next?: AthenaAuthCapabilitiesStatus
): AthenaAuthCapabilitiesStatus {
  if (!next) return current;
  if (current === "unknown" || next === "unknown") {
    if (current === "known" && next === "unknown") return "partial";
    if (current === "unknown" && next === "known") return "partial";
    return next === "unknown" ? "unknown" : current === "unknown" ? next : "partial";
  }
  if (current === "partial" || next === "partial") return "partial";
  return "known";
}

export function createAthenaAuthCapabilitiesStore(
  initial?: Partial<AthenaAuthCapabilitiesResult>
): AthenaAuthCapabilitiesStore {
  let value: AthenaAuthCapabilitiesResult = {
    ...EMPTY_UNKNOWN,
    ...initial,
    status: initial?.status ?? "unknown",
    source: initial?.source ?? "fallback",
  };
  const listeners = new Set<(v: AthenaAuthCapabilitiesResult) => void>();

  const emit = () => {
    for (const listener of [...listeners]) {
      listener(value);
    }
  };

  const get = (): AthenaAuthCapabilitiesResult => value;

  return {
    get,
    getSnapshot: get,

    set(next) {
      value = { ...next, fetchedAt: next.fetchedAt ?? Date.now() };
      emit();
    },

    merge(patch, meta) {
      value = {
        ...value,
        ...patch,
        passkey:
          patch.passkey === undefined
            ? value.passkey
            : { ...(value.passkey ?? {}), ...(patch.passkey ?? {}) },
        social:
          patch.social === undefined
            ? value.social
            : { ...(value.social ?? {}), ...(patch.social ?? {}) },
        status: pickStatus(value.status, meta?.status),
        source: meta?.source ?? value.source,
        fetchedAt: Date.now(),
      };
      emit();
      return value;
    },

    markUnknown(source = "http") {
      // Keep last known feature hints; only status becomes unknown/partial.
      value = {
        ...value,
        status: value.status === "known" ? "partial" : "unknown",
        source,
        fetchedAt: Date.now(),
      };
      emit();
      return value;
    },

    hydrate(next) {
      if (value.status !== "unknown") {
        return false;
      }
      value = { ...next, fetchedAt: next.fetchedAt ?? Date.now() };
      emit();
      return true;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** True only when capability is definitively enabled. */
export function isCapabilityEnabled(
  caps: AthenaAuthCapabilitiesResult,
  key: keyof AthenaAuthCapabilitiesFeatures
): boolean {
  if (caps.status === "unknown") return false;
  const v = caps[key];
  if (v == null) return false;
  if (typeof v === "boolean") return v === true && caps.status === "known";
  return false;
}

/**
 * Passkey-first onboarding. Never inferred from `passkeys === true`.
 * Unknown is not enabled.
 */
export function isPasskeyOnboardingEnabled(
  caps: AthenaAuthCapabilitiesResult,
): boolean {
  if (!isCapabilityEnabled(caps, "passkeys")) {
    return false;
  }
  return caps.passkey?.onboarding === true;
}

/**
 * Social providers to show: only when known (or partial with explicit list).
 * Never invent an empty "disabled" list from unknown.
 */
export function resolveSocialProvidersForUi(
  caps: AthenaAuthCapabilitiesResult
): { providers: string[] | null; hide: boolean } {
  if (caps.status === "unknown") {
    return { providers: null, hide: false };
  }
  const list = caps.social?.providers;
  if (list == null) {
    return { providers: null, hide: caps.status === "known" };
  }
  return { providers: list, hide: false };
}

/** True only when status is known and at least one social provider is listed. */
export function isSocialCapabilityEnabled(
  caps: AthenaAuthCapabilitiesResult
): boolean {
  if (caps.status !== "known") {
    return false;
  }
  return (caps.social?.providers?.length ?? 0) > 0;
}
