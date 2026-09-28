const REDACTION_MARKER = "***";
const MAX_STRING_LENGTH = 4096;
const MAX_DEPTH = 6;
const MAX_ENTRIES = 50;
const MAX_ARRAY_ITEMS = 50;
const MAX_EVENT_BYTES = 64 * 1024;

const SECRET_KEY =
  /(?:pass(?:word|phrase)|secret|client[_-]?secret|access[_-]?token|refresh[_-]?token|session[_-]?token|(?:api|admin)[_-]?key|athena[_-]?(?:key[_-]?12|p12[_-]?key)|connection[_-]?string|database[_-]?url|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|private[_-]?key|signing[_-]?key|bridgeCode|bridge[_-]?code)/i;
const RAW_ARGV_KEY = /^raw[-_]?argv$/i;
const URL_PATTERN =
  /\b(?:postgres(?:ql)?|https?|rediss?|redis|smtp|mysql):\/\/[^\s"'<>]+/gi;
const SENSITIVE_QUERY_KEY =
  /(?:pass(?:word|wd)?|secret|token|access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|authorization|auth|signature|sig|code)/i;
const PEM_PRIVATE_KEY =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g;
const JWT_PATTERN =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const ATHENA_KEY_PATTERN =
  /\bath_(?:live|test|admin|secret|key)_[A-Za-z0-9_-]{16,}\b/gi;
const ATHENA_BRIDGE_CODE_PATTERN = /\bath_brc_[A-Za-z0-9_-]{16,}\b/gi;
const UNLABELED_CANDIDATE_PATTERN =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,128}(?![A-Za-z0-9_-])/g;
const ATHENA_COMPOSITE_KEY_PATTERN =
  /\bath_[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{12,}\b/gi;
const PROVIDER_TOKEN_PATTERN =
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b|\b(?:live|test)_[A-Za-z0-9_-]{20,}\b/gi;
const ATHENA_ENV_KEY_PATTERN =
  /(\bATHENA_(?:KEY_12|P12_KEY|API_KEY|GATEWAY_API_KEY)\s*[=:]\s*)[^\s,;]+/gi;
const DEFAULT_SECRET_FLAGS = [
  "--access-token",
  "--admin-key",
  "--api-key",
  "--auth-token",
  "--authorization",
  "--bridge-code",
  "--client-secret",
  "--client-key",
  "--credential-file",
  "--connection-string",
  "--cookie",
  "--credential",
  "--credentials",
  "--database-password",
  "--database-url",
  "--db-password",
  "--encryption-key",
  "--key-file",
  "--key",
  "--mollie-key",
  "--password",
  "--passphrase",
  "--p12-key",
  "--private-key",
  "--private-key-file",
  "--proxy-authorization",
  "--refresh-token",
  "--secret",
  "--secret-key",
  "--session-token",
  "--set-cookie",
  "--signing-secret",
  "--signing-key",
  "--token",
  "--webhook-secret",
  "--webhook-signing-secret",
] as const;
const DEFAULT_OPTION_FLAGS = new Set([
  "--admin-key",
  "--allow-dirty",
  "--allow-dirty-migrations",
  "--apply",
  "--action",
  "--classify-only",
  "--bytes",
  "--color",
  "--connection",
  "--config",
  "--cwd",
  "--customer",
  "--debug",
  "--description",
  "--dry-run",
  "--env-file",
  "--env-key",
  "--errors",
  "--expires-at",
  "--file",
  "--force",
  "--format",
  "--from",
  "--groups",
  "--help",
  "--include-latest-log",
  "--include-ambiguous",
  "--id",
  "--json",
  "--limit",
  "--migration",
  "--mode",
  "--name",
  "--no-color",
  "--no-discover-schemas",
  "--no-log",
  "--no-write-config",
  "--older-than",
  "--out",
  "--out-file",
  "--output",
  "--policy-impact",
  "--plain",
  "--prefix",
  "--profile",
  "--provider",
  "--resource",
  "--rights",
  "--skip-runtime",
  "--short",
  "--strict",
  "--subject",
  "--url",
  "--verbose",
  "--yes",
  "--write",
  "--write-config",
  "--row",
  "--cursor",
  "--max-pages",
  "--max-customers",
  "--max-duration",
  "-C",
  "-c",
  "-f",
  "-h",
  "-j",
  "-o",
  "-q",
  "-v",
  "-y",
]);

export interface ArgvSanitizationPolicy {
  readonly optionFlags?: readonly string[];
  readonly secretFlags?: readonly string[];
}

function normalizeFlag(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function flagPart(token: string): string {
  const equals = token.indexOf("=");
  return equals === -1 ? token : token.slice(0, equals);
}

function isRecognizedOption(
  token: string,
  optionFlags: ReadonlySet<string>
): boolean {
  if (token === "--") {
    return true;
  }
  return optionFlags.has(normalizeFlag(flagPart(token)));
}

function isSafeUrlToken(token: string): boolean {
  const match =
    /^(.*?=)?((?:postgres(?:ql)?|https?|rediss?|redis|smtp|mysql):\/\/[^\s"'<>]+)$/i.exec(
      token
    );
  if (!match) {
    return false;
  }
  try {
    const url = new URL(match[2]);
    return (
      url.password.length === 0 &&
      !Array.from(url.searchParams.keys()).some((key) =>
        SENSITIVE_QUERY_KEY.test(key)
      ) &&
      !(url.hash && SENSITIVE_QUERY_KEY.test(url.hash))
    );
  } catch {
    return false;
  }
}

function redactCliToken(token: string): string {
  if (isSafeUrlToken(token)) {
    return token;
  }
  return redactSecrets(token).replaceAll(REDACTION_MARKER, "[REDACTED]");
}

/**
 * Sanitize command-line arguments while preserving their diagnostic shape.
 *
 * Secret options are handled semantically so a short, low-entropy, or
 * punctuation-prefixed value cannot bypass generic text redaction.
 */
export function sanitizeCliArgv(
  argv: readonly string[],
  policy: ArgvSanitizationPolicy = {}
): string[] {
  const secretFlags = new Set(
    (policy.secretFlags ?? DEFAULT_SECRET_FLAGS).map(normalizeFlag)
  );
  const optionFlags = new Set([
    ...DEFAULT_OPTION_FLAGS,
    ...(policy.optionFlags ?? []).map(normalizeFlag),
  ]);
  const sanitized: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    const flag = normalizeFlag(flagPart(token));
    if (!secretFlags.has(flag)) {
      sanitized.push(redactCliToken(token));
      continue;
    }

    const equals = token.indexOf("=");
    if (equals !== -1) {
      sanitized.push(`${token.slice(0, equals)}=[REDACTED]`);
      continue;
    }

    sanitized.push(token);
    const next = argv[index + 1];
    if (next !== undefined && !isRecognizedOption(String(next), optionFlags)) {
      sanitized.push("[REDACTED]");
      index += 1;
    }
  }

  return sanitized;
}

function capString(value: string): string {
  if (value.length <= MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, MAX_STRING_LENGTH)}…`;
}

function redactUrlCandidate(candidate: string): string {
  const trailing = candidate.match(/[.,;:!?)}\]]+$/)?.[0] ?? "";
  const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
  try {
    const url = new URL(core);
    if (url.password) {
      url.password = REDACTION_MARKER;
    }
    for (const key of Array.from(url.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEY.test(key)) {
        url.searchParams.set(key, REDACTION_MARKER);
      }
    }
    if (url.hash && SENSITIVE_QUERY_KEY.test(url.hash)) {
      url.hash = `#${REDACTION_MARKER}`;
    }
    return `${url.toString()}${trailing}`;
  } catch {
    return candidate;
  }
}

function redactKeyValueSecrets(input: string): string {
  return input
    .replace(
      /(\b(?:authorization|proxy[-_]?authorization)\s*:\s*(?:bearer|basic)\s+)[^\s,;]+/gi,
      "$1***"
    )
    .replace(/(\b(?:cookie|set[-_]?cookie)\s*:\s*)[^\r\n]+/gi, "$1***")
    .replace(
      /(\b(?:password|passphrase|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|session[-_]?token|api[-_]?key|admin[-_]?key|cookie|set[-_]?cookie|bridge[-_]?code)\s*[=:]\s*)[^\s,;]+/gi,
      "$1***"
    );
}

function isLikelyGeneratedSecret(value: string): boolean {
  if (/^[0-9a-f]{32,64}$/i.test(value) || /^[0-9a-f-]{36}$/.test(value)) {
    return false;
  }
  if (/^[A-Z][A-Z0-9_-]*$/.test(value)) {
    return false;
  }
  const unique = new Set(value).size;
  if (unique < 16) {
    return false;
  }
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  const entropy = [...frequencies.values()].reduce((total, count) => {
    const probability = count / value.length;
    return total - probability * Math.log2(probability);
  }, 0);
  return entropy >= 4.2;
}

function redactUnlabeledSecrets(input: string): string {
  return input.replace(UNLABELED_CANDIDATE_PATTERN, (candidate) =>
    isLikelyGeneratedSecret(candidate) ? REDACTION_MARKER : candidate
  );
}

/**
 * Redact secrets from free-form text. This is the single persistent-log
 * string redaction path; callers should not add command-specific expressions.
 */
export function redactSecrets(input: string): string {
  let output = input;
  output = output.replace(PEM_PRIVATE_KEY, REDACTION_MARKER);
  output = output.replace(URL_PATTERN, redactUrlCandidate);
  output = output.replace(JWT_PATTERN, REDACTION_MARKER);
  output = output.replace(ATHENA_KEY_PATTERN, REDACTION_MARKER);
  output = output.replace(ATHENA_BRIDGE_CODE_PATTERN, REDACTION_MARKER);
  output = output.replace(ATHENA_COMPOSITE_KEY_PATTERN, REDACTION_MARKER);
  output = output.replace(PROVIDER_TOKEN_PATTERN, REDACTION_MARKER);
  output = output.replace(ATHENA_ENV_KEY_PATTERN, "$1***");
  output = redactKeyValueSecrets(output);
  return redactUnlabeledSecrets(output);
}

function isBuffer(value: object): value is { length: number } {
  return typeof Buffer !== "undefined" && Buffer.isBuffer(value);
}

function isTypedArray(value: object): value is ArrayBufferView {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function redactObject(
  value: object,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (seen.has(value)) {
    return "[Circular]";
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }
  seen.add(value);

  if (value instanceof Error) {
    const error: Record<string, unknown> = {
      message: redactSecrets(value.message),
      name: value.name,
    };
    if (value.stack) {
      error.stack = redactSecrets(value.stack);
    }
    if ("code" in value && typeof value.code === "string") {
      error.code = value.code;
    }
    if (value.cause !== undefined) {
      error.cause = redactObjectValue(value.cause, depth + 1, seen);
    }
    if (value instanceof AggregateError) {
      error.errors = value.errors
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item) => redactObjectValue(item, depth + 1, seen));
    }
    for (const key of Object.keys(value).slice(0, MAX_ENTRIES)) {
      if (!(key in error)) {
        error[key] = redactObjectValue(
          value[key as keyof typeof value],
          depth + 1,
          seen
        );
      }
    }
    return error;
  }

  if (value instanceof URL) {
    return redactUrlCandidate(value.toString());
  }
  if (isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }
  if (isTypedArray(value)) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value).slice(0, MAX_ENTRIES)) {
    if (RAW_ARGV_KEY.test(key)) {
      continue;
    }
    if (SECRET_KEY.test(key)) {
      if (
        /(?:connection|string|database|url)/i.test(key) &&
        typeof nested === "string"
      ) {
        out[key] = redactSecrets(nested);
      } else {
        out[key] = REDACTION_MARKER;
      }
      continue;
    }
    out[key] = redactObjectValue(nested, depth + 1, seen);
  }
  return out;
}

function redactObjectValue(
  value: unknown,
  depth: number,
  seen: WeakSet<object>
): unknown {
  if (typeof value === "string") {
    return capString(redactSecrets(value));
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (value === undefined || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) {
      return "[Truncated]";
    }
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactObjectValue(item, depth + 1, seen));
  }
  return redactObject(value, depth, seen);
}

export function redactValue(value: unknown): unknown {
  return redactObjectValue(value, 0, new WeakSet<object>());
}

export function sanitizeCliError(
  error: unknown,
  options: { includeStack?: boolean; maxDepth?: number } = {}
): {
  name: string;
  code?: string;
  message: string;
  stack?: string;
  cause?: ReturnType<typeof sanitizeCliError>;
  metadata?: Record<string, unknown>;
} {
  const maxDepth = options.maxDepth ?? 4;
  const seen = new WeakSet<object>();
  const visit = (
    value: unknown,
    depth: number
  ): ReturnType<typeof sanitizeCliError> => {
    if (value instanceof Error) {
      const result: ReturnType<typeof sanitizeCliError> = {
        message: redactSecrets(value.message || "Unknown error."),
        name: value.name || "Error",
      };
      if ("code" in value && typeof value.code === "string") {
        result.code = value.code;
      }
      if (options.includeStack && value.stack) {
        result.stack = redactSecrets(value.stack);
      }
      if (value.cause !== undefined && depth < maxDepth) {
        result.cause = visit(value.cause, depth + 1);
      }
      if (value instanceof AggregateError) {
        result.metadata = {
          errors: value.errors
            .slice(0, MAX_ARRAY_ITEMS)
            .map((item) => redactObjectValue(item, 0, seen)),
        };
      }
      const metadata: Record<string, unknown> = {};
      for (const key of Object.keys(value).slice(0, MAX_ENTRIES)) {
        if (key !== "cause" && key !== "message" && key !== "stack") {
          metadata[key] = redactObjectValue(
            value[key as keyof typeof value],
            0,
            seen
          );
        }
      }
      if (Object.keys(metadata).length > 0) {
        result.metadata = { ...result.metadata, ...metadata };
      }
      return result;
    }
    return {
      message: redactSecrets(typeof value === "string" ? value : String(value)),
      name: "Error",
    };
  };
  return visit(error, 0);
}

export function serializeCliLogEvent(event: unknown): string {
  const sanitized = redactValue(event) as Record<string, unknown>;
  let json = redactSecrets(JSON.stringify(sanitized));
  if (Buffer.byteLength(json, "utf8") > MAX_EVENT_BYTES) {
    const minimal = redactValue({
      data: { truncated: true },
      invocationId: sanitized.invocationId,
      kind: sanitized.kind,
      level: sanitized.level,
      message: sanitized.message,
      schemaVersion: 1,
      sequence: typeof sanitized.sequence === "number" ? sanitized.sequence : 0,
      timestamp: sanitized.timestamp,
      traceId: sanitized.traceId,
      truncated: true,
    });
    json = redactSecrets(JSON.stringify(minimal));
  }
  return json;
}
