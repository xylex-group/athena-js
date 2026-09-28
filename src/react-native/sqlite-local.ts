import type {
  AthenaSqliteExecutor,
  AthenaSqliteExecutorCapabilities,
} from "../sqlite-local/contracts.ts";

/**
 * Host bridge for RN local data. The package owns no native module and does
 * not construct Auth; the app supplies a structural executor from its chosen
 * native SQLite library.
 */
export interface ReactNativeSqliteLocalHost {
  capabilities: AthenaSqliteExecutorCapabilities;
  execute: AthenaSqliteExecutor["execute"];
  transaction: AthenaSqliteExecutor["transaction"];
  close?: AthenaSqliteExecutor["close"];
}

export function createReactNativeSqliteLocalExecutor(
  input: { executor: ReactNativeSqliteLocalHost },
): AthenaSqliteExecutor {
  const host = input.executor;
  return {
    capabilities: host.capabilities,
    execute: host.execute.bind(host),
    transaction: host.transaction.bind(host),
    ...(host.close ? { close: host.close.bind(host) } : {}),
  };
}

