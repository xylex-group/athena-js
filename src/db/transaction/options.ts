import { AthenaTransactionError } from "./errors.ts";
import type {
  AthenaResolvedTransactionOptions,
  AthenaTransactionCapabilities,
  AthenaTransactionOptions,
} from "./types.ts";

export function resolveTransactionOptions(
  capabilities: AthenaTransactionCapabilities,
  options?: AthenaTransactionOptions,
  callOptions?: AthenaResolvedTransactionOptions["callOptions"]
): AthenaResolvedTransactionOptions {
  if (options?.isolationLevel) {
    if (!capabilities.isolationLevels.includes(options.isolationLevel)) {
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_ISOLATION_UNSUPPORTED",
        `Isolation level "${options.isolationLevel}" is not supported by backend "${capabilities.backend}"`,
        {
          backend: capabilities.backend,
          isolationLevel: options.isolationLevel,
          supported: [...capabilities.isolationLevels],
        }
      );
    }
  }
  if (options?.readOnly && !capabilities.readOnly) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      `readOnly transactions are not supported by backend "${capabilities.backend}"`,
      { backend: capabilities.backend, option: "readOnly" }
    );
  }
  if (options?.deferrable && !capabilities.deferrable) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_OPTION_UNSUPPORTED",
      `deferrable transactions are not supported by backend "${capabilities.backend}"`,
      { backend: capabilities.backend, option: "deferrable" }
    );
  }
  return {
    callOptions,
    deferrable: Boolean(options?.deferrable),
    idempotencyKey: options?.idempotencyKey,
    isolationLevel: options?.isolationLevel,
    readOnly: Boolean(options?.readOnly),
    signal: options?.signal,
    timeoutMs: options?.timeoutMs,
  };
}
