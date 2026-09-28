import { AsyncLocalStorage } from "node:async_hooks";

interface CliDebugStore {
  readonly enabled: boolean;
}

const debugContext = new AsyncLocalStorage<CliDebugStore>();

export function isDebugEnabled(): boolean {
  const activeDebug = debugContext.getStore();
  if (activeDebug !== undefined) {
    return activeDebug.enabled;
  }
  const value = (
    globalThis as { process?: { env?: Record<string, string | undefined> } }
  ).process?.env?.ATHENA_JS_DEBUG;
  return value === "1" || value === "true";
}

export async function withCliDebugContext<T>(
  enabled: boolean,
  operation: () => Promise<T> | T
): Promise<T> {
  return debugContext.run({ enabled }, async () => operation());
}
