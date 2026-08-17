/**
 * Status-aware auth capabilities (INV-P).
 *
 * Lookup failure must never be treated as "all features disabled".
 * UI may hide/disable only when `status === "known"` and the field is false,
 * or when the app sets an explicit features override.
 */

export type AthenaAuthCapabilitiesStatus = "known" | "partial" | "unknown";

export type AthenaAuthCapabilitiesSource =
  | "bootstrap"
  | "http"
  | "client-config"
  | "fallback";

export interface AthenaAuthCapabilitiesFeatures {
  password?: boolean | null;
  organizations?: boolean | null;
  passkeys?: boolean | null;
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
  subscribe(listener: (value: AthenaAuthCapabilitiesResult) => void): () => void;
}

const EMPTY_UNKNOWN: AthenaAuthCapabilitiesResult = {
  status: "unknown",
  source: "fallback",
};

/** Frozen 5.1 embedded Auth advertisement. Social/passkeys stay false until implemented. */
export const ATHENA_AUTH_EMBEDDED_CAPABILITY_SNAPSHOT: AthenaAuthCapabilitiesResult =
  {
    emailAndPassword: true,
    organizations: true,
    passkeys: false,
    password: true,
    sessions: true,
    social: { providers: [] },
    source: "bootstrap",
    status: "known",
  };

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
