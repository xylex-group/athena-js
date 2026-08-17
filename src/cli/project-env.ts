/**
 * Project env-file loading and validation for the athena-js CLI.
 *
 * Load order matches the generator (`loadGeneratorConfig`):
 * `.env` → `.env.local` → `.env.<NODE_ENV>` → `.env.<NODE_ENV>.local`
 * Shell / process env wins over file values for the same key.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ATHENA_ENV_API_KEY_KEYS,
  ATHENA_ENV_CLIENT_KEYS,
  ATHENA_ENV_DB_URL_KEYS,
  ATHENA_ENV_PRIMARY_KEYS,
  ATHENA_ENV_URL_KEYS,
} from "../env/index.ts";
import { PACKAGE_VERSION } from "../sdk-version.ts";

const PROJECT_ENV_FILENAMES = [".env", ".env.local"] as const;

const DIRECT_CONNECTION_STRING_ENV_KEYS = [
  "ATHENA_GENERATOR_PG_URL",
  "DATABASE_URL",
  "PG_URL",
  "POSTGRES_URL",
  "POSTGRESQL_URL",
] as const;

const GATEWAY_URL_ENV_KEYS = [
  ...ATHENA_ENV_URL_KEYS,
  ...ATHENA_ENV_DB_URL_KEYS,
  "ATHENA_GENERATOR_URL",
] as const;

const GATEWAY_API_KEY_ENV_KEYS = [
  ...ATHENA_ENV_API_KEY_KEYS,
  "ATHENA_GENERATOR_API_KEY",
] as const;

const PLACEHOLDER_VALUE_RE =
  /\$\{[A-Za-z_][A-Za-z0-9_]*\}|<\w+>|your[-_ ].+|changeme|xxx+|todo|replace[-_ ]me|example\.com\/api/i;

export type EnvCheckMode = "auto" | "direct" | "gateway";
export type EnvCheckSeverity = "ok" | "warn" | "error";
export type EnvValueSource = "process" | "file" | "missing";

export interface EnvFileEntry {
  absolutePath: string;
  filename: string;
  keys: string[];
}

export interface EnvFieldCheck {
  field: string;
  keysTried: readonly string[];
  message: string;
  severity: EnvCheckSeverity;
  source?: EnvValueSource;
  sourceKey?: string;
  sourcePath?: string;
  /** Redacted preview when a value is present. */
  valuePreview?: string;
}

export interface EnvCheckResult {
  checks: EnvFieldCheck[];
  cwd: string;
  errorCount: number;
  files: EnvFileEntry[];
  mode: EnvCheckMode;
  resolvedMode: "direct" | "gateway" | "none";
  sdkVersion: string;
  warnCount: number;
}

export interface LoadProjectEnvOptions {
  cwd?: string;
  /** Explicit env file paths (relative to cwd or absolute). When set, only these are read. */
  files?: string[];
  /** Optional process env override (defaults to process.env). */
  processEnv?: Record<string, string | undefined>;
}

export interface LoadedProjectEnv {
  /** Absolute paths that existed and were parsed. */
  files: EnvFileEntry[];
  /** key → { value, source, sourcePath?, sourceKey } with process winning. */
  values: Map<
    string,
    {
      source: Exclude<EnvValueSource, "missing">;
      sourceKey: string;
      sourcePath?: string;
      value: string;
    }
  >;
}

function normalizeRawEnvValue(rawValue: string): string {
  if (
    rawValue.startsWith('"') &&
    rawValue.endsWith('"') &&
    rawValue.length >= 2
  ) {
    const inner = rawValue.slice(1, -1);
    return inner
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  if (
    rawValue.startsWith("'") &&
    rawValue.endsWith("'") &&
    rawValue.length >= 2
  ) {
    return rawValue.slice(1, -1);
  }

  const commentIndex = rawValue.search(/\s+#/);
  const withoutComment =
    commentIndex >= 0 ? rawValue.slice(0, commentIndex) : rawValue;
  return withoutComment.trim();
}

export function parseEnvLine(
  line: string
): [key: string, value: string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return undefined;
  }

  const match = trimmed.match(
    /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/
  );
  if (!match) {
    return undefined;
  }

  const [, key, rawValue] = match;
  return [key, normalizeRawEnvValue(rawValue.trim())];
}

function readEnvFile(
  absolutePath: string
): { entries: Map<string, string>; keys: string[] } {
  const content = readFileSync(absolutePath, "utf8");
  const entries = new Map<string, string>();
  const keys: string[] = [];
  for (const line of content.split(/\r?\n/g)) {
    const parsed = parseEnvLine(line);
    if (!parsed) {
      continue;
    }
    const [key, value] = parsed;
    if (!entries.has(key)) {
      keys.push(key);
    }
    entries.set(key, value);
  }
  return { entries, keys };
}

function defaultEnvFilenames(
  processEnv: Record<string, string | undefined>
): string[] {
  const nodeEnv = processEnv.NODE_ENV?.trim();
  return [
    ...PROJECT_ENV_FILENAMES,
    ...(nodeEnv ? [`.env.${nodeEnv}`, `.env.${nodeEnv}.local`] : []),
  ];
}

export function loadProjectEnv(
  options: LoadProjectEnvOptions = {}
): LoadedProjectEnv {
  const cwd = options.cwd ?? process.cwd();
  const processEnv = options.processEnv ?? process.env;
  const filenames =
    options.files && options.files.length > 0
      ? options.files
      : defaultEnvFilenames(processEnv);

  const fileLayers: Array<{
    absolutePath: string;
    entries: Map<string, string>;
    filename: string;
    keys: string[];
  }> = [];

  for (const filename of filenames) {
    const absolutePath = resolve(cwd, filename);
    if (!existsSync(absolutePath)) {
      continue;
    }
    const { entries, keys } = readEnvFile(absolutePath);
    fileLayers.push({ absolutePath, entries, filename, keys });
  }

  const values: LoadedProjectEnv["values"] = new Map();

  // Later files override earlier files (same as generator apply order).
  for (const layer of fileLayers) {
    for (const [key, value] of layer.entries.entries()) {
      values.set(key, {
        source: "file",
        sourceKey: key,
        sourcePath: layer.absolutePath,
        value,
      });
    }
  }

  // Process env wins.
  for (const [key, raw] of Object.entries(processEnv)) {
    if (typeof raw !== "string") {
      continue;
    }
    const trimmed = raw.trim();
    if (!trimmed) {
      continue;
    }
    values.set(key, {
      source: "process",
      sourceKey: key,
      value: trimmed,
    });
  }

  return {
    files: fileLayers.map((layer) => ({
      absolutePath: layer.absolutePath,
      filename: layer.filename,
      keys: layer.keys,
    })),
    values,
  };
}

function redactSecret(value: string): string {
  if (value.length <= 8) {
    return "*".repeat(Math.min(value.length, 4));
  }
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_VALUE_RE.test(value.trim());
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isPostgresConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "postgres:" ||
      url.protocol === "postgresql:" ||
      // allow bare driver URLs some hosts use
      url.protocol === "pg:"
    );
  } catch {
    return false;
  }
}

function pickFirst(
  loaded: LoadedProjectEnv,
  keys: readonly string[]
):
  | {
      source: Exclude<EnvValueSource, "missing">;
      sourceKey: string;
      sourcePath?: string;
      value: string;
    }
  | undefined {
  for (const key of keys) {
    const hit = loaded.values.get(key);
    if (hit?.value) {
      return hit;
    }
  }
  return undefined;
}

function fieldCheck(input: {
  field: string;
  keysTried: readonly string[];
  message: string;
  severity: EnvCheckSeverity;
  hit?: {
    source: Exclude<EnvValueSource, "missing">;
    sourceKey: string;
    sourcePath?: string;
    value: string;
  };
  previewAsSecret?: boolean;
}): EnvFieldCheck {
  if (!input.hit) {
    return {
      field: input.field,
      keysTried: input.keysTried,
      message: input.message,
      severity: input.severity,
      source: "missing",
    };
  }

  return {
    field: input.field,
    keysTried: input.keysTried,
    message: input.message,
    severity: input.severity,
    source: input.hit.source,
    sourceKey: input.hit.sourceKey,
    sourcePath: input.hit.sourcePath,
    valuePreview: input.previewAsSecret
      ? redactSecret(input.hit.value)
      : input.hit.value.length > 80
        ? `${input.hit.value.slice(0, 77)}…`
        : input.hit.value,
  };
}

export interface ValidateProjectEnvOptions extends LoadProjectEnvOptions {
  mode?: EnvCheckMode;
  /**
   * When true, missing optional companion keys become errors.
   * Default false (warnings for optional / incomplete pairs).
   */
  strict?: boolean;
}

/**
 * Validate Athena-related keys and URLs from project env files + process env.
 */
export function validateProjectEnv(
  options: ValidateProjectEnvOptions = {}
): EnvCheckResult {
  const cwd = options.cwd ?? process.cwd();
  const mode = options.mode ?? "auto";
  const strict = options.strict === true;
  const loaded = loadProjectEnv({
    cwd,
    files: options.files,
    processEnv: options.processEnv,
  });

  const checks: EnvFieldCheck[] = [];
  const gatewayUrl = pickFirst(loaded, GATEWAY_URL_ENV_KEYS);
  const apiKey = pickFirst(loaded, GATEWAY_API_KEY_ENV_KEYS);
  const databaseUrl = pickFirst(loaded, DIRECT_CONNECTION_STRING_ENV_KEYS);
  const client = pickFirst(loaded, ATHENA_ENV_CLIENT_KEYS);
  const authUrl = pickFirst(loaded, [
    ATHENA_ENV_PRIMARY_KEYS.authUrl,
    "NEXT_PUBLIC_ATHENA_AUTH_URL",
  ]);

  let resolvedMode: EnvCheckResult["resolvedMode"] = "none";
  if (mode === "direct") {
    resolvedMode = "direct";
  } else if (mode === "gateway") {
    resolvedMode = "gateway";
  } else if (databaseUrl && !(gatewayUrl && apiKey)) {
    resolvedMode = "direct";
  } else if (gatewayUrl || apiKey) {
    resolvedMode = "gateway";
  } else if (databaseUrl) {
    resolvedMode = "direct";
  }

  // Gateway URL
  if (gatewayUrl) {
    if (isPlaceholderValue(gatewayUrl.value)) {
      checks.push(
        fieldCheck({
          field: "gatewayUrl",
          hit: gatewayUrl,
          keysTried: GATEWAY_URL_ENV_KEYS,
          message: `Looks like an unexpanded placeholder or sample value in ${gatewayUrl.sourceKey}.`,
          severity: "error",
        })
      );
    } else if (!isAbsoluteHttpUrl(gatewayUrl.value)) {
      checks.push(
        fieldCheck({
          field: "gatewayUrl",
          hit: gatewayUrl,
          keysTried: GATEWAY_URL_ENV_KEYS,
          message: `${gatewayUrl.sourceKey} must be an absolute http(s) URL.`,
          severity: "error",
        })
      );
    } else {
      checks.push(
        fieldCheck({
          field: "gatewayUrl",
          hit: gatewayUrl,
          keysTried: GATEWAY_URL_ENV_KEYS,
          message: `Resolved from ${gatewayUrl.sourceKey} (${gatewayUrl.source}).`,
          severity: "ok",
        })
      );
    }
  } else if (resolvedMode === "gateway" || mode === "gateway") {
    checks.push(
      fieldCheck({
        field: "gatewayUrl",
        keysTried: GATEWAY_URL_ENV_KEYS,
        message: `Missing gateway URL. Set ${ATHENA_ENV_PRIMARY_KEYS.url} (or ATHENA_GATEWAY_URL).`,
        severity: "error",
      })
    );
  } else {
    checks.push(
      fieldCheck({
        field: "gatewayUrl",
        keysTried: GATEWAY_URL_ENV_KEYS,
        message: "No gateway URL set (optional for direct Postgres mode).",
        severity: "warn",
      })
    );
  }

  // API key
  if (apiKey) {
    if (isPlaceholderValue(apiKey.value)) {
      checks.push(
        fieldCheck({
          field: "apiKey",
          hit: apiKey,
          keysTried: GATEWAY_API_KEY_ENV_KEYS,
          message: `Looks like an unexpanded placeholder or sample value in ${apiKey.sourceKey}.`,
          previewAsSecret: true,
          severity: "error",
        })
      );
    } else if (apiKey.value.length < 8) {
      checks.push(
        fieldCheck({
          field: "apiKey",
          hit: apiKey,
          keysTried: GATEWAY_API_KEY_ENV_KEYS,
          message: `${apiKey.sourceKey} is unusually short (< 8 chars).`,
          previewAsSecret: true,
          severity: strict ? "error" : "warn",
        })
      );
    } else {
      checks.push(
        fieldCheck({
          field: "apiKey",
          hit: apiKey,
          keysTried: GATEWAY_API_KEY_ENV_KEYS,
          message: `Resolved from ${apiKey.sourceKey} (${apiKey.source}).`,
          previewAsSecret: true,
          severity: "ok",
        })
      );
    }
  } else if (resolvedMode === "gateway" || mode === "gateway") {
    checks.push(
      fieldCheck({
        field: "apiKey",
        keysTried: GATEWAY_API_KEY_ENV_KEYS,
        message: `Missing API key. Set ${ATHENA_ENV_PRIMARY_KEYS.apiKey} (generate with: athena-js api-key generate).`,
        severity: "error",
      })
    );
  } else {
    checks.push(
      fieldCheck({
        field: "apiKey",
        keysTried: GATEWAY_API_KEY_ENV_KEYS,
        message: "No API key set (required for gateway mode).",
        severity: "warn",
      })
    );
  }

  // Database URL (direct)
  if (databaseUrl) {
    if (isPlaceholderValue(databaseUrl.value)) {
      checks.push(
        fieldCheck({
          field: "databaseUrl",
          hit: databaseUrl,
          keysTried: DIRECT_CONNECTION_STRING_ENV_KEYS,
          message: `Looks like an unexpanded placeholder or sample value in ${databaseUrl.sourceKey}.`,
          previewAsSecret: true,
          severity: "error",
        })
      );
    } else if (!isPostgresConnectionString(databaseUrl.value)) {
      checks.push(
        fieldCheck({
          field: "databaseUrl",
          hit: databaseUrl,
          keysTried: DIRECT_CONNECTION_STRING_ENV_KEYS,
          message: `${databaseUrl.sourceKey} must be a postgres/postgresql connection URL.`,
          previewAsSecret: true,
          severity: "error",
        })
      );
    } else {
      checks.push(
        fieldCheck({
          field: "databaseUrl",
          hit: databaseUrl,
          keysTried: DIRECT_CONNECTION_STRING_ENV_KEYS,
          message: `Resolved from ${databaseUrl.sourceKey} (${databaseUrl.source}).`,
          previewAsSecret: true,
          severity: "ok",
        })
      );
    }
  } else if (resolvedMode === "direct" || mode === "direct") {
    checks.push(
      fieldCheck({
        field: "databaseUrl",
        keysTried: DIRECT_CONNECTION_STRING_ENV_KEYS,
        message:
          "Missing DATABASE_URL (or PG_URL / POSTGRES_URL) for direct mode.",
        severity: "error",
      })
    );
  } else {
    checks.push(
      fieldCheck({
        field: "databaseUrl",
        keysTried: DIRECT_CONNECTION_STRING_ENV_KEYS,
        message: "No direct Postgres URL set (optional for gateway mode).",
        severity: "warn",
      })
    );
  }

  // Optional companions
  if (client) {
    checks.push(
      fieldCheck({
        field: "client",
        hit: client,
        keysTried: ATHENA_ENV_CLIENT_KEYS,
        message: `Resolved from ${client.sourceKey} (${client.source}).`,
        severity: "ok",
      })
    );
  } else if (resolvedMode === "gateway") {
    checks.push(
      fieldCheck({
        field: "client",
        keysTried: ATHENA_ENV_CLIENT_KEYS,
        message:
          "ATHENA_CLIENT not set (optional X-Athena-Client registry name).",
        severity: "warn",
      })
    );
  }

  if (authUrl) {
    if (!isAbsoluteHttpUrl(authUrl.value) || isPlaceholderValue(authUrl.value)) {
      checks.push(
        fieldCheck({
          field: "authUrl",
          hit: authUrl,
          keysTried: [
            ATHENA_ENV_PRIMARY_KEYS.authUrl,
            "NEXT_PUBLIC_ATHENA_AUTH_URL",
          ],
          message: `${authUrl.sourceKey} must be an absolute http(s) URL.`,
          severity: "error",
        })
      );
    } else {
      checks.push(
        fieldCheck({
          field: "authUrl",
          hit: authUrl,
          keysTried: [
            ATHENA_ENV_PRIMARY_KEYS.authUrl,
            "NEXT_PUBLIC_ATHENA_AUTH_URL",
          ],
          message: `Resolved from ${authUrl.sourceKey} (${authUrl.source}).`,
          severity: "ok",
        })
      );
    }
  }

  if (loaded.files.length === 0) {
    checks.push({
      field: "envFiles",
      keysTried: options.files ?? defaultEnvFilenames(options.processEnv ?? {}),
      message:
        "No project env files found (.env / .env.local). Only process env was checked.",
      severity: "warn",
      source: "missing",
    });
  }

  if (resolvedMode === "none") {
    checks.push({
      field: "mode",
      keysTried: [...GATEWAY_URL_ENV_KEYS, ...DIRECT_CONNECTION_STRING_ENV_KEYS],
      message:
        "Could not infer mode. Set ATHENA_URL + ATHENA_API_KEY (gateway) or DATABASE_URL (direct).",
      severity: "error",
      source: "missing",
    });
  }

  const errorCount = checks.filter((c) => c.severity === "error").length;
  const warnCount = checks.filter((c) => c.severity === "warn").length;

  return {
    checks,
    cwd,
    errorCount,
    files: loaded.files,
    mode,
    resolvedMode,
    sdkVersion: PACKAGE_VERSION,
    warnCount,
  };
}

export function formatEnvCheckReport(result: EnvCheckResult): string {
  const lines: string[] = [
    `athena-js env check (sdk ${result.sdkVersion})`,
    `cwd: ${result.cwd}`,
    `mode: requested=${result.mode} resolved=${result.resolvedMode}`,
    `files: ${
      result.files.length > 0
        ? result.files.map((f) => f.filename).join(", ")
        : "(none)"
    }`,
    "",
  ];

  for (const check of result.checks) {
    const tag = check.severity.toUpperCase().padEnd(5);
    const preview = check.valuePreview ? ` value=${check.valuePreview}` : "";
    const key = check.sourceKey ? ` key=${check.sourceKey}` : "";
    lines.push(`[${tag}] ${check.field}${key}${preview}`);
    lines.push(`       ${check.message}`);
  }

  lines.push("");
  lines.push(
    `summary: ${result.errorCount} error(s), ${result.warnCount} warning(s)`
  );
  if (result.errorCount === 0) {
    lines.push("result: OK");
  } else {
    lines.push("result: FAILED");
  }

  return lines.join("\n");
}