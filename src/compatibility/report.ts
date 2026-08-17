/**
 * Athena-JS ↔ Athena server compatibility reporting (3.7 Dragunov program).
 *
 * Discovery is lazy and cached per client. Normal query paths must not hard-fail
 * solely because health is unavailable unless a required protocol is unsafe.
 */

import { ATHENA_GATEWAY_ROUTES } from "../gateway/routes.ts";
import type { AthenaReleaseIdentity } from "../release/identity.ts";
import {
  type AthenaNormalizedHealth,
  normalizeAthenaHealthPayload,
} from "../release/identity.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";

export interface AthenaCompatibilityWarning {
  code: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface AthenaCompatibilityReport {
  compatible: boolean;
  discovered: boolean;
  protocols: {
    structuredQuery: number;
    errors: number;
    health: number;
  };
  release: AthenaReleaseIdentity;
  sdk: {
    package: "@xylex-group/athena";
    version: string;
  };
  server: {
    product: string;
    version: string;
    codename: string | null;
    channel: string | null;
  };
  warnings: AthenaCompatibilityWarning[];
}

export interface AthenaCompatibilityCache {
  health: AthenaNormalizedHealth | null;
  inflight: Promise<AthenaCompatibilityReport> | null;
  report: AthenaCompatibilityReport | null;
}

export function createCompatibilityCache(): AthenaCompatibilityCache {
  return {
    health: null,
    inflight: null,
    report: null,
  };
}

function parseMajor(version: string | null | undefined): number | null {
  if (!version) {
    return null;
  }
  const match = version.trim().match(/^(\d+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

/**
 * Build a report from a health payload without network I/O.
 */
export function buildCompatibilityReportFromHealth(
  healthBody: unknown,
  options?: { discovered?: boolean }
): AthenaCompatibilityReport {
  const health = normalizeAthenaHealthPayload(healthBody);
  const major = parseMajor(health.release.version);
  const warnings: AthenaCompatibilityWarning[] = [];

  if (major !== null && major < 4) {
    warnings.push({
      code: "ATHENA_SERVER_MAJOR_UNSUPPORTED",
      message: `Athena server major ${major} is below the supported 4.1.x / 5.0.x range`,
      severity: "error",
    });
  }
  if (major !== null && major > 5) {
    warnings.push({
      code: "ATHENA_SERVER_MAJOR_NEWER",
      message: `Athena server major ${major} is newer than this SDK's validated range (4.1.x–5.0.x); treat as best-effort`,
      severity: "warning",
    });
  }
  if (health.release.codename === null && major === 5) {
    warnings.push({
      code: "ATHENA_RELEASE_CODENAME_MISSING",
      message:
        "Athena 5 health response is missing release.codename; continuing with SemVer only",
      severity: "info",
    });
  }

  const compatible = !warnings.some((w) => w.severity === "error");

  return {
    compatible,
    discovered: options?.discovered ?? true,
    protocols: {
      errors: 1,
      health: health.release.codename !== null || major === 5 ? 2 : 1,
      structuredQuery: 1,
    },
    release: health.release,
    sdk: {
      package: "@xylex-group/athena",
      version: PACKAGE_VERSION,
    },
    server: {
      channel: health.release.channel,
      codename: health.release.codename,
      product: health.release.product,
      version: health.release.version,
    },
    warnings,
  };
}

/**
 * Conservative offline report when health discovery fails or is skipped.
 */
export function buildUndiscoveredCompatibilityReport(): AthenaCompatibilityReport {
  const release = {
    channel: "stable" as const,
    codename: null,
    displayName: "Athena unknown",
    product: "Athena",
    version: "unknown",
  };
  return {
    compatible: true,
    discovered: false,
    protocols: {
      errors: 1,
      health: 1,
      structuredQuery: 1,
    },
    release,
    sdk: {
      package: "@xylex-group/athena",
      version: PACKAGE_VERSION,
    },
    server: {
      channel: null,
      codename: null,
      product: release.product,
      version: release.version,
    },
    warnings: [
      {
        code: "ATHENA_COMPAT_UNDISCOVERED",
        message:
          "Server compatibility not discovered yet; using conservative protocol defaults",
        severity: "info",
      },
    ],
  };
}

export interface DiscoverCompatibilityOptions {
  apiKey?: string;
  baseUrl: string;
  cache: AthenaCompatibilityCache;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
}

/**
 * Lazy cached GET /health (falls back to GET /). Does not throw on network failure —
 * returns an undiscovered-compatible report so CRUD can continue on Athena 4/5.
 */
export async function discoverCompatibility(
  options: DiscoverCompatibilityOptions
): Promise<AthenaCompatibilityReport> {
  if (options.cache.report?.discovered) {
    return options.cache.report;
  }
  if (options.cache.inflight) {
    return options.cache.inflight;
  }

  const run = async (): Promise<AthenaCompatibilityReport> => {
    const fetchFn = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== "function") {
      const report = buildUndiscoveredCompatibilityReport();
      options.cache.report = report;
      return report;
    }

    const base = options.baseUrl.replace(/\/+$/, "");
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(options.headers ?? {}),
    };
    if (options.apiKey) {
      headers["X-API-Key"] = options.apiKey;
    }

    const tryPath = async (path: string): Promise<unknown | null> => {
      try {
        const response = await fetchFn(`${base}${path}`, {
          headers,
          method: "GET",
        });
        if (!response.ok) {
          return null;
        }
        return await response.json();
      } catch {
        return null;
      }
    };

    const body =
      (await tryPath(ATHENA_GATEWAY_ROUTES.health)) ??
      (await tryPath(ATHENA_GATEWAY_ROUTES.root));

    if (body === null) {
      const report = buildUndiscoveredCompatibilityReport();
      options.cache.report = report;
      return report;
    }

    const health = normalizeAthenaHealthPayload(body);
    options.cache.health = health;
    const report = buildCompatibilityReportFromHealth(body, {
      discovered: true,
    });
    options.cache.report = report;
    return report;
  };

  options.cache.inflight = run().finally(() => {
    options.cache.inflight = null;
  });
  return options.cache.inflight;
}
