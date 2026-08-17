import type {
  AthenaAuthCallOptions,
  AthenaAuthGetTokenRequest,
  AthenaAuthResult,
  AthenaAuthToken,
} from "./types.ts";

export type { AthenaAuthGetTokenRequest, AthenaAuthToken };

export type AthenaAuthGetTokenInput = AthenaAuthGetTokenRequest;

export interface AthenaAuthTokenProviderOptions {
  audience?: string | string[];
  /** Refresh this many seconds before `exp`. Default 60. */
  refreshSkewSeconds?: number;
}

export interface AthenaAuthTokenProvider {
  getToken: (
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthToken>>;
  invalidate: () => void;
}

const DEFAULT_REFRESH_SKEW_SECONDS = 60;

export function normalizeTokenAudiences(
  audience: string | string[] | undefined
): string[] {
  if (audience == null) {
    return [];
  }
  return (Array.isArray(audience) ? audience : [audience])
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function tokenNeedsRefresh(
  token: AthenaAuthToken,
  nowMs = Date.now(),
  refreshSkewSeconds = DEFAULT_REFRESH_SKEW_SECONDS
): boolean {
  const expiresAt = Date.parse(token.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    const exp = decodeJwtExpSeconds(token.token);
    if (exp == null) {
      return true;
    }
    return exp * 1000 <= nowMs + refreshSkewSeconds * 1000;
  }
  return expiresAt <= nowMs + refreshSkewSeconds * 1000;
}

export function decodeJwtExpSeconds(token: string): number | null {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    const payload = JSON.parse(
      decodeJwtSegment(parts[1] ?? "")
    ) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function decodeJwtSegment(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  if (typeof atob === "function") {
    return atob(`${padded}${pad}`);
  }
  return Buffer.from(`${padded}${pad}`, "base64").toString("utf8");
}

export function createAthenaAuthTokenProvider(
  issue: (
    input: AthenaAuthGetTokenInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthResult<AthenaAuthToken>>,
  providerOptions: AthenaAuthTokenProviderOptions = {}
): AthenaAuthTokenProvider {
  let cached: AthenaAuthToken | null = null;
  let inflight: Promise<AthenaAuthResult<AthenaAuthToken>> | null = null;
  const refreshSkewSeconds =
    providerOptions.refreshSkewSeconds ?? DEFAULT_REFRESH_SKEW_SECONDS;

  const getToken = async (
    options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthResult<AthenaAuthToken>> => {
    if (cached && !tokenNeedsRefresh(cached, Date.now(), refreshSkewSeconds)) {
      return {
        data: cached,
        error: null,
        ok: true,
        raw: cached,
        status: 200,
      };
    }
    if (inflight) {
      return inflight;
    }
    inflight = issue(
      { audience: providerOptions.audience },
      options
    )
      .then((result) => {
        cached = result.ok ? result.data : null;
        return result;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    getToken,
    invalidate() {
      cached = null;
      inflight = null;
    },
  };
}