import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const REDACTION = "***";
const BUFFER_LIMIT = 256;
const SECRET_FLAGS = new Set([
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
]);
const OPTION_FLAGS = new Set([
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
const URL_PATTERN =
  /\b(?:postgres(?:ql)?|https?|rediss?|redis|smtp|mysql):\/\/[^\s"'<>]+/gi;
const TOKEN_PATTERN =
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b|\bath_(?:live|test|admin|secret|key)_[A-Za-z0-9_-]{16,}\b|\bath_brc_[A-Za-z0-9_-]{16,}\b|\bath_[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{12,}\b|\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9_-]{16,}\b/gi;
const KEY_VALUE_PATTERN =
  /(\b(?:password|passphrase|secret|client[-_]?secret|access[-_]?token|refresh[-_]?token|session[-_]?token|api[-_]?key|admin[-_]?key|authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|bridge[-_]?code)\s*[=:]\s*)([^\s,;]+)/gi;
const ATHENA_ENV_KEY_PATTERN =
  /(\bATHENA_(?:KEY_12|P12_KEY|API_KEY|GATEWAY_API_KEY)\s*[=:]\s*)([^\s,;]+)/gi;
const UNLABELED_CANDIDATE_PATTERN =
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{20,128}(?![A-Za-z0-9_-])/g;

function normalizeFlag(value) {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

function isSafeUrlToken(token) {
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
        /password|secret|token|key|auth|signature|code/i.test(key)
      ) &&
      !(url.hash && /password|secret|token|key|auth|code/i.test(url.hash))
    );
  } catch {
    return false;
  }
}

export function sanitizeCliArgv(argv) {
  const sanitized = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = String(argv[index]);
    const equals = token.indexOf("=");
    const rawFlag = equals === -1 ? token : token.slice(0, equals);
    const flag = normalizeFlag(rawFlag);
    if (!SECRET_FLAGS.has(flag)) {
      sanitized.push(
        isSafeUrlToken(token)
          ? token
          : redact(token).replaceAll(REDACTION, "[REDACTED]")
      );
      continue;
    }
    if (equals !== -1) {
      sanitized.push(`${token.slice(0, equals)}=[REDACTED]`);
      continue;
    }
    sanitized.push(token);
    const next = argv[index + 1];
    if (next !== undefined) {
      const nextToken = String(next);
      const nextEquals = nextToken.indexOf("=");
      const nextFlag = normalizeFlag(
        nextEquals === -1 ? nextToken : nextToken.slice(0, nextEquals)
      );
      if (nextToken !== "--" && !OPTION_FLAGS.has(nextFlag)) {
        sanitized.push("[REDACTED]");
        index += 1;
      }
    }
  }
  return sanitized;
}

function redactUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.password) {
      parsed.password = REDACTION;
    }
    for (const key of parsed.searchParams.keys()) {
      if (/password|secret|token|key|auth|signature|code/i.test(key)) {
        parsed.searchParams.set(key, REDACTION);
      }
    }
    if (
      parsed.hash &&
      /password|secret|token|key|auth|code/i.test(parsed.hash)
    ) {
      parsed.hash = `#${REDACTION}`;
    }
    return parsed.toString();
  } catch {
    return value;
  }
}

function redact(value) {
  const redacted = String(value)
    .replace(
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g,
      REDACTION
    )
    .replace(URL_PATTERN, redactUrl)
    .replace(TOKEN_PATTERN, REDACTION)
    .replace(KEY_VALUE_PATTERN, "$1***")
    .replace(ATHENA_ENV_KEY_PATTERN, "$1***");
  return redacted.replace(UNLABELED_CANDIDATE_PATTERN, (candidate) => {
    if (
      /^[0-9a-f]{32,64}$/i.test(candidate) ||
      /^[0-9a-f-]{36}$/i.test(candidate) ||
      /^[A-Z][A-Z0-9_-]*$/.test(candidate)
    ) {
      return candidate;
    }
    return new Set(candidate).size >= 16 ? REDACTION : candidate;
  });
}

function safeValue(value, seen = new WeakSet(), depth = 0) {
  if (depth >= 6) {
    return "[Truncated]";
  }
  if (typeof value === "string") {
    const redacted = redact(value);
    return redacted.length > 4096 ? `${redacted.slice(0, 4096)}…` : redacted;
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
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (value instanceof Error) {
    const result = {
      message: redact(value.message),
      name: value.name,
    };
    if (value.code !== undefined) {
      result.code = value.code;
    }
    if (value.stack) {
      result.stack = redact(value.stack);
    }
    if (value.cause !== undefined) {
      result.cause = safeValue(value.cause, seen, depth + 1);
    }
    return result;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => safeValue(item, seen, depth + 1));
  }
  if (Buffer.isBuffer(value)) {
    return `[Buffer ${value.length} bytes]`;
  }
  if (ArrayBuffer.isView(value)) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`;
  }
  const result = {};
  for (const [key, nested] of Object.entries(value).slice(0, 50)) {
    if (/^raw[-_]?argv$/i.test(key)) {
      continue;
    }
    if (
      /password|passphrase|secret|token|api[-_]?key|admin[-_]?key|authorization|cookie|private[-_]?key|signing[-_]?key|bridge[-_]?code/i.test(
        key
      )
    ) {
      result[key] = REDACTION;
    } else {
      result[key] = safeValue(nested, seen, depth + 1);
    }
  }
  return result;
}

function modeFromEnvironment(env, noLog) {
  if (noLog) {
    return "off";
  }
  const mode = env.ATHENA_CLI_LOG;
  return mode === "off" || mode === "errors" || mode === "debug" ? mode : "all";
}

function pathsFor(env, cwd, now, invocationId) {
  const configured = env.ATHENA_HOME?.trim();
  const home = configured
    ? resolve(cwd, configured)
    : resolve(homedir(), ".athena");
  const cliLogsRoot = join(home, "logs", "athena-js");
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const timestamp = iso.replace(/[-:]/g, "");
  const dayDir = join(cliLogsRoot, day);
  return {
    cliLogsRoot,
    dayDir,
    home,
    latestPointer: join(cliLogsRoot, "latest.json"),
    logFile: join(dayDir, `${timestamp}-${invocationId}.jsonl`),
  };
}

export function createBootstrapSession({
  argv,
  cwd = process.cwd(),
  env = process.env,
  packageVersion = "unknown",
  noLog = false,
}) {
  const mode = modeFromEnvironment(env, noLog);
  const startedAt = new Date();
  const startedMonotonicNs = process.hrtime.bigint().toString();
  const invocationId = randomUUID();
  const traceId = randomBytes(16).toString("hex");
  const paths = pathsFor(env, cwd, startedAt, invocationId);
  let sequence = 0;
  let finalized = false;
  let firstFailure;
  let delegate;
  let fallbackPromise;
  let events = [];
  let truncated = false;
  const errorIds = new WeakMap();

  function errorIdFor(error) {
    if (
      error === null ||
      (typeof error !== "object" && typeof error !== "function")
    ) {
      return randomUUID();
    }
    const existing = errorIds.get(error);
    if (existing) {
      return existing;
    }
    const id = randomUUID();
    errorIds.set(error, id);
    return id;
  }

  function serializedEvent(event) {
    const safeEvent = safeValue(event);
    let encoded;
    try {
      encoded = JSON.stringify(safeEvent);
    } catch {
      encoded = JSON.stringify({
        data: { truncated: true },
        invocationId,
        kind: "logger.failure",
        level: "error",
        schemaVersion: 1,
        sequence: safeEvent.sequence,
        timestamp: safeEvent.timestamp,
        traceId,
        writer: "bootstrap",
      });
    }
    if (Buffer.byteLength(encoded, "utf8") <= 64 * 1024) {
      return encoded;
    }
    return JSON.stringify({
      data: { truncated: true },
      invocationId,
      kind: safeEvent.kind,
      level: safeEvent.level,
      message:
        typeof safeEvent.message === "string"
          ? safeEvent.message.slice(0, 512)
          : undefined,
      schemaVersion: 1,
      sequence: safeEvent.sequence,
      timestamp: safeEvent.timestamp,
      traceId,
      truncated: true,
      writer: "bootstrap",
    });
  }

  function boundedEvent(event) {
    const encoded = serializedEvent(event);
    return Buffer.byteLength(encoded, "utf8") <= 64 * 1024
      ? event
      : JSON.parse(encoded);
  }

  function makeEvent(input) {
    return safeValue({
      invocationId,
      schemaVersion: 1,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      traceId,
      writer: "bootstrap",
      ...input,
    });
  }

  function capture(event) {
    const bounded = boundedEvent(event);
    if (events.length < BUFFER_LIMIT) {
      events.push(bounded);
      return;
    }
    if (!truncated) {
      truncated = true;
      const marker = makeEvent({
        data: { truncated: true },
        kind: "diagnostic",
        level: "warn",
        message: "Bootstrap logging buffer truncated.",
      });
      events = [
        events[0],
        ...events.slice(-(BUFFER_LIMIT - 2)),
        boundedEvent(marker),
      ];
    }
  }

  function enqueue(event) {
    if (finalized || mode === "off") {
      return;
    }
    if (delegate) {
      delegate.enqueue(event);
      return;
    }
    const safeEvent = safeValue(event);
    if (Number.isInteger(safeEvent.sequence)) {
      sequence = Math.max(sequence, safeEvent.sequence);
    }
    capture(safeEvent);
  }

  function record(input) {
    if (finalized || mode === "off") {
      return;
    }
    if (delegate) {
      delegate.record(input);
      return;
    }
    capture(
      makeEvent({
        commandId: input.commandId,
        data: safeValue(input.data),
        durationMs: input.durationMs,
        error: input.error === undefined ? undefined : safeValue(input.error),
        errorId:
          input.errorId ??
          (input.error === undefined ? undefined : errorIdFor(input.error)),
        exitCode: input.exitCode,
        kind: input.kind,
        level: input.level,
        message: input.message ? redact(input.message) : undefined,
        outcome: input.outcome,
        parentSpanId: input.parentSpanId,
        spanId: input.spanId,
      })
    );
  }

  async function writeFallback() {
    if (mode === "off" || delegate) {
      return;
    }
    if (mode === "errors" && events.at(-1)?.outcome === "success") {
      return;
    }
    await mkdir(paths.dayDir, { mode: 0o700, recursive: true });
    const body = events.map(serializedEvent).join("\n");
    const temporary = join(
      paths.dayDir,
      `.${invocationId}-${randomUUID()}.tmp`
    );
    await writeFile(temporary, body.length > 0 ? `${body}\n` : "", {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await rename(temporary, paths.logFile);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
    const pointerTemporary = join(
      paths.cliLogsRoot,
      `.latest-${invocationId}-${randomUUID()}.tmp`
    );
    await writeFile(
      pointerTemporary,
      `${JSON.stringify(
        {
          invocationId,
          path: paths.logFile,
          schemaVersion: 1,
          startedAt: startedAt.toISOString(),
          traceId,
          updatedAt: new Date().toISOString(),
          writer: "bootstrap",
        },
        null,
        2
      )}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    try {
      await rename(pointerTemporary, paths.latestPointer);
    } catch (error) {
      if (error?.code !== "EEXIST" && error?.code !== "EPERM") {
        await unlink(pointerTemporary).catch(() => undefined);
        throw error;
      }
      await unlink(paths.latestPointer).catch(() => undefined);
      await rename(pointerTemporary, paths.latestPointer);
    }
  }

  const root = {
    adopt(next) {
      if (delegate || mode === "off") {
        return;
      }
      const handoff = root.getBootstrapHandoff();
      if (typeof next?.adoptBootstrap !== "function") {
        throw new Error("Canonical logger cannot adopt bootstrap events.");
      }
      next.adoptBootstrap(handoff);
      delegate = next;
    },
    child(data) {
      if (delegate) {
        return delegate.child(data);
      }
      const child = Object.create(root);
      child.record = (input) =>
        root.record({ ...input, data: { ...data, ...input.data } });
      child.debug = (message, metadata) =>
        child.record({
          data: metadata,
          kind: "diagnostic",
          level: "debug",
          message,
        });
      child.info = (message, metadata) =>
        child.record({
          data: metadata,
          kind: "diagnostic",
          level: "info",
          message,
        });
      child.warn = (message, metadata) =>
        child.record({
          data: metadata,
          kind: "diagnostic",
          level: "warn",
          message,
        });
      child.error = (message, metadata, error) =>
        child.record({
          data: metadata,
          error,
          kind: "error",
          level: "error",
          message,
        });
      child.finish = () => undefined;
      child.flush = () => root.flush();
      return child;
    },
    debug(message, data) {
      if (delegate) {
        delegate.debug(message, data);
        return;
      }
      record({ data, kind: "diagnostic", level: "debug", message });
    },
    enqueue,
    error(message, data, error) {
      if (delegate) {
        delegate.error(message, data, error);
        return;
      }
      record({ data, error, kind: "error", level: "error", message });
    },
    finish(options) {
      if (delegate) {
        delegate.finish(options);
        finalized = true;
        return;
      }
      if (finalized || mode === "off") {
        return;
      }
      finalized = true;
      capture(
        makeEvent({
          commandId: options.commandId,
          data: {
            ...options.data,
            loggingFailed: firstFailure !== undefined,
          },
          durationMs:
            options.durationMs ?? Math.max(0, Date.now() - startedAt.getTime()),
          exitCode: options.exitCode,
          kind: "invocation.finish",
          level: options.outcome === "success" ? "info" : "error",
          outcome: options.outcome,
        })
      );
      if (mode === "errors" && options.outcome === "success") {
        events = [];
        return;
      }
      fallbackPromise = writeFallback().catch((error) => {
        firstFailure ??= error;
      });
    },
    async flush() {
      if (delegate) {
        await delegate.flush();
        return;
      }
      await fallbackPromise?.catch(() => undefined);
    },
    getBootstrapHandoff() {
      return {
        events: events.map((event) => safeValue(event)),
        fallback: {
          enabled: true,
          logRoot: paths.cliLogsRoot,
        },
        invocationId,
        sanitizedArgv: sanitizeCliArgv(argv),
        sequence,
        startedAt: startedAt.toISOString(),
        startedMonotonicNs,
        traceId,
        version: 1,
      };
    },
    info(message, data) {
      if (delegate) {
        delegate.info(message, data);
        return;
      }
      record({ data, kind: "diagnostic", level: "info", message });
    },
    invocationId,
    get loggingFailed() {
      return delegate?.loggingFailed ?? firstFailure !== undefined;
    },
    get logPath() {
      return mode === "off" ? undefined : (delegate?.logPath ?? paths.logFile);
    },
    mode,
    record,
    traceId,
    warn(message, data) {
      if (delegate) {
        delegate.warn(message, data);
        return;
      }
      record({ data, kind: "diagnostic", level: "warn", message });
    },
  };

  record({
    data: {
      architecture: process.arch,
      cwd,
      nodeVersion: process.version,
      packageVersion,
      parentPid: process.ppid,
      pid: process.pid,
      platform: process.platform,
      sanitizedArgv: sanitizeCliArgv(argv),
    },
    kind: "invocation.start",
    level: "info",
    message: "Athena JS CLI invocation started.",
  });
  if (
    env.ATHENA_CLI_LOG !== undefined &&
    env.ATHENA_CLI_LOG !== "off" &&
    env.ATHENA_CLI_LOG !== "errors" &&
    env.ATHENA_CLI_LOG !== "all" &&
    env.ATHENA_CLI_LOG !== "debug"
  ) {
    root.warn("Unknown ATHENA_CLI_LOG value; using all.", {
      configuredMode: env.ATHENA_CLI_LOG,
    });
  }
  return root;
}
