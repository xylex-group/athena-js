import type { EnvLike } from "./athena-auth-url.ts";

/**
 * Read the first non-empty trimmed environment variable from a name list.
 *
 * @param names - Candidate env keys in priority order
 * @param env - Optional env map (defaults to `process.env`)
 * @returns Trimmed value of the first key that is set and non-empty
 * @throws {Error} When none of the keys yield a non-empty value
 *
 * @example
 * ```ts
 * import { requireEnv } from "@xylex-group/athena/utils"
 *
 * const authUrl = requireEnv([
 *   "ATHENA_AUTH_UPSTREAM_URL",
 *   "ATHENA_AUTH_URL",
 *   "NEXT_PUBLIC_ATHENA_AUTH_URL",
 * ])
 * ```
 */
export function requireEnv(names: readonly string[], env?: EnvLike): string {
  if (!names.length) {
    throw new Error(
      "requireEnv() requires at least one environment variable name."
    );
  }

  const source = env ?? readProcessEnv();
  for (const name of names) {
    const value = source[name]?.trim();
    if (value) {
      return value;
    }
  }

  throw new Error(
    `Missing required environment variable. Expected one of: ${names.join(", ")}`
  );
}

/**
 * Like {@link requireEnv}, but returns `undefined` instead of throwing when
 * none of the keys are set.
 */
export function readEnv(
  names: readonly string[],
  env?: EnvLike
): string | undefined {
  if (!names.length) {
    return undefined;
  }

  const source = env ?? readProcessEnv();
  for (const name of names) {
    const value = source[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function readProcessEnv(): EnvLike {
  try {
    const processEnv = (globalThis as { process?: { env?: EnvLike } }).process
      ?.env;
    return processEnv ?? {};
  } catch {
    return {};
  }
}
