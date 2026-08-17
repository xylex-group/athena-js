/**
 * Access Node env without referencing the bare `process` global name.
 * Keeps DTS/tsup builds green when `@types/node` is not on the type path
 * (Cloudflare Workers Builds for consumers that compile monorepo athena-js).
 */

type ProcessEnvLike = Record<string, string | undefined>;

function getProcess(): { env?: ProcessEnvLike } | undefined {
  return (globalThis as { process?: { env?: ProcessEnvLike } }).process;
}

export function getProcessEnv(): ProcessEnvLike | undefined {
  return getProcess()?.env;
}

export function getNodeEnv(): string | undefined {
  return getProcessEnv()?.NODE_ENV;
}

export function isNodeProductionEnv(): boolean {
  return getNodeEnv() === "production";
}

export function getProcessEnvVar(key: string): string | undefined {
  return getProcessEnv()?.[key];
}
