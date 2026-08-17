/**
 * Resolve query diagnostics flags for {@link createClient}.
 *
 * Prefer `diagnostics: 'auto'` in Next/OpenNext apps so production builds stay
 * quiet without app-local OPENNEXT_BUILD branching.
 */

import type { AthenaQueryTraceOptions } from "./client.ts";

export type AthenaDiagnosticsMode = boolean | "auto";

export interface AthenaDiagnosticsInput {
  debugAst?: boolean;
  diagnostics?: AthenaDiagnosticsMode;
  env?: Record<string, string | undefined>;
  findManyAst?: boolean;
  traceQueries?: boolean | AthenaQueryTraceOptions;
}

export interface ResolvedAthenaDiagnostics {
  debugAst: boolean;
  findManyAst: boolean;
  /**
   * When the input was a trace options object, it is preserved when enabled.
   * When disabled, becomes `false`.
   */
  traceQueries: boolean | AthenaQueryTraceOptions;
}

function readProcessEnv(): Record<string, string | undefined> {
  try {
    return (
      (globalThis as { process?: { env?: Record<string, string | undefined> } })
        .process?.env ?? {}
    );
  } catch {
    return {};
  }
}

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

/**
 * True for production runtime and common Next/OpenNext build phases where
 * chatty AST/trace output should stay off by default.
 */
export function isQuietAthenaDiagnosticsEnvironment(
  env: Record<string, string | undefined> = readProcessEnv()
): boolean {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase();
  if (nodeEnv === "production") {
    return true;
  }
  if (isTruthyEnv(env.OPENNEXT_BUILD)) {
    return true;
  }
  const nextPhase = env.NEXT_PHASE?.trim();
  if (nextPhase === "phase-production-build") {
    return true;
  }
  // CI unit tests often set NODE_ENV=test; only quiet generic CI production-ish runs.
  if (
    isTruthyEnv(env.CI) &&
    nodeEnv !== "test" &&
    (nodeEnv === "production" || isTruthyEnv(env.OPENNEXT_BUILD))
  ) {
    return true;
  }
  return false;
}

function resolveBooleanFlag(
  explicit: boolean | undefined,
  mode: AthenaDiagnosticsMode | undefined,
  quiet: boolean
): boolean {
  if (typeof explicit === "boolean") {
    return explicit;
  }
  if (mode === true) {
    return true;
  }
  if (mode === false) {
    return false;
  }
  if (mode === "auto") {
    // Auto keeps defaults off; quiet envs are handled by collapsing mode to false.
    void quiet;
    return false;
  }
  // Undefined mode: historical default (off unless explicit).
  return false;
}

/**
 * Merge `diagnostics` mode with per-flag overrides.
 *
 * - `diagnostics: true` → enable AST flags (and trace) when not explicitly set
 * - `diagnostics: false` → disable when not explicitly set
 * - `diagnostics: 'auto'` → disable in production / OpenNext build / production-build phase
 * - explicit `debugAst` / `findManyAst` / `traceQueries` always win
 */
export function resolveAthenaClientDiagnostics(
  input: AthenaDiagnosticsInput
): ResolvedAthenaDiagnostics {
  const env = input.env ?? readProcessEnv();
  const quiet = isQuietAthenaDiagnosticsEnvironment(env);
  const mode = input.diagnostics;

  // In quiet envs, auto (or explicit false) keeps defaults off even if callers
  // only set diagnostics mode.
  const effectiveMode: AthenaDiagnosticsMode | undefined =
    mode === "auto" && quiet ? false : mode;

  const debugAst = resolveBooleanFlag(input.debugAst, effectiveMode, quiet);
  const findManyAst = resolveBooleanFlag(
    input.findManyAst,
    effectiveMode,
    quiet
  );

  let traceQueries: ResolvedAthenaDiagnostics["traceQueries"];
  if (input.traceQueries !== undefined) {
    if (typeof input.traceQueries === "boolean") {
      traceQueries = input.traceQueries;
    } else if (effectiveMode === false || (mode === "auto" && quiet)) {
      // Quiet override only when the object didn't set enabled: true explicitly.
      const enabled = input.traceQueries.enabled;
      traceQueries =
        typeof enabled === "boolean"
          ? enabled
            ? input.traceQueries
            : false
          : false;
    } else {
      traceQueries = input.traceQueries;
    }
  } else if (effectiveMode === true) {
    traceQueries = true;
  } else {
    traceQueries = false;
  }

  return {
    debugAst,
    findManyAst,
    traceQueries,
  };
}
