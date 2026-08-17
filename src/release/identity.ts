/**
 * Athena product release identity (server-facing metadata).
 *
 * Codenames are human-facing only. Never branch feature logic on codename —
 * use protocol/capability negotiation instead.
 */

export type AthenaReleaseChannel =
  | "development"
  | "nightly"
  | "alpha"
  | "beta"
  | "rc"
  | "stable"
  | (string & {});

export interface AthenaReleaseIdentity {
  channel: AthenaReleaseChannel;
  codename: string | null;
  displayName: string;
  product: string;
  version: string;
}

export interface AthenaHealthReleaseWire {
  channel?: unknown;
  codename?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  product?: unknown;
  version?: unknown;
}

export interface AthenaNormalizedHealth {
  message: string | null;
  /** Raw health body (or null if parse failed). */
  raw: unknown;
  /** Normalized release identity (never fails solely because Athena 4 omits release). */
  release: AthenaReleaseIdentity;
  status: string | null;
  /** Product package version from body.version when present. */
  version: string | null;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Normalize a server health `release` object (Athena 5) or synthesize
 * conservative Athena 4 identity from a top-level `version` field.
 */
export function normalizeAthenaReleaseIdentity(
  wire: unknown,
  fallbackVersion?: string | null
): AthenaReleaseIdentity {
  const record = isRecord(wire) ? (wire as AthenaHealthReleaseWire) : null;
  const product = nonEmptyString(record?.product) ?? "Athena";
  const version =
    nonEmptyString(record?.version) ??
    nonEmptyString(fallbackVersion) ??
    "unknown";
  const codename = nonEmptyString(record?.codename) ?? null;
  const channel = (nonEmptyString(record?.channel) ??
    "stable") as AthenaReleaseChannel;
  const displayName =
    nonEmptyString(record?.display_name) ??
    nonEmptyString(record?.displayName) ??
    (codename
      ? `${product} ${version} — ${codename}`
      : `${product} ${version}`);

  return {
    channel,
    codename,
    displayName,
    product,
    version,
  };
}

/**
 * Normalize GET / or GET /health response bodies for Athena 4 and Athena 5.
 * Missing `release` is not an error.
 */
export function normalizeAthenaHealthPayload(
  body: unknown
): AthenaNormalizedHealth {
  const record = isRecord(body) ? body : null;
  const version = nonEmptyString(record?.version) ?? null;
  const release = normalizeAthenaReleaseIdentity(record?.release, version);
  return {
    message: nonEmptyString(record?.message) ?? null,
    raw: body,
    release,
    status: nonEmptyString(record?.status) ?? null,
    version,
  };
}
