import type { AthenaResult, AthenaResultFormatter } from "../../client-result.ts";
import type { AthenaExecutable } from "../../query/descriptor.ts";
import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaGatewayResponse } from "../../gateway/types.ts";
import { getTransactionCacheObserver } from "./cache.ts";
import { compileTransactionOperations } from "./compile.ts";
import { AthenaTransactionError } from "./errors.ts";
import { resolveTransactionOptions } from "./options.ts";
import type {
  AthenaInteractiveTransactionTransport,
  AthenaResolvedTransactionOptions,
  AthenaTransactionCacheObserver,
  AthenaTransactionCapabilities,
  AthenaTransactionOperation,
  AthenaTransactionOptions,
  AthenaTransactionResults,
} from "./types.ts";
import { UNSUPPORTED_TRANSACTION_CAPABILITIES } from "./types.ts";

export function getTransactionTransport(
  gateway: AthenaGatewayClient
): {
  capabilities: AthenaTransactionCapabilities;
  transport: NonNullable<AthenaGatewayClient["transactions"]> | undefined;
} {
  const transport = gateway.transactions;
  return {
    capabilities: transport?.capabilities ?? UNSUPPORTED_TRANSACTION_CAPABILITIES,
    transport,
  };
}

export async function pinTransactionCallOptions(
  gateway: AthenaGatewayClient,
  signal?: AbortSignal
) {
  const resolved = await gateway.resolveCallOptions(
    signal ? { signal } : undefined
  );
  return resolved;
}

/**
 * The pinned snapshot may include organization/credentials.
 * Per-operation builders must not smuggle a different principal.
 */
function rejectOperationContextOverride(
  pinned: AthenaResolvedTransactionOptions["callOptions"] | undefined,
  operationOptions: AthenaResolvedTransactionOptions["callOptions"] | undefined
): void {
  if (!operationOptions) {
    return;
  }
  const fields = [
    "apiKey",
    "bearerToken",
    "organizationId",
    "sessionToken",
    "userId",
    "client",
  ] as const;
  for (const field of fields) {
    const next = operationOptions[field];
    if (next === undefined || next === null) {
      continue;
    }
    const pinnedValue = pinned?.[field];
    if (pinnedValue !== next) {
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_CONTEXT_OVERRIDE",
        "Transaction operations cannot override client, organization, credentials, or principal",
        { field, next, pinned: pinnedValue ?? null }
      );
    }
  }
}

function mapTransportResult(
  response: AthenaGatewayResponse<unknown>,
  formatGatewayResult: AthenaResultFormatter,
  operation: AthenaTransactionOperation
): AthenaResult<unknown> {
  return formatGatewayResult(response, {
    operation: operation.kind,
    table: operation.descriptor.target.table,
  });
}

function firstFailedResult(
  results: readonly AthenaResult<unknown>[]
): AthenaResult<unknown> | undefined {
  return results.find((result) => result.error);
}

export async function executeAtomicTransaction<
  T extends readonly AthenaExecutable<unknown>[],
>(input: {
  cache?: AthenaTransactionCacheObserver;
  formatGatewayResult: AthenaResultFormatter;
  gateway: AthenaGatewayClient;
  operations: T;
  options?: AthenaTransactionOptions;
}): Promise<AthenaTransactionResults<T>> {
  const { capabilities, transport } = getTransactionTransport(input.gateway);
  if (!(transport && capabilities.atomic)) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_ATOMIC_UNSUPPORTED",
      `Atomic transactions are not supported by backend "${capabilities.backend}"`,
      {
        backend: capabilities.backend,
        requested: "atomic",
        suggestion: "Use a backend that advertises capabilities.db.transactions.atomic",
      }
    );
  }
  const compiled = compileTransactionOperations(input.operations);
  const pinned = await pinTransactionCallOptions(
    input.gateway,
    input.options?.signal
  );
  const resolved = resolveTransactionOptions(
    capabilities,
    input.options,
    pinned
  );
  const executed = await transport.executeAtomic(compiled, resolved);
  const results = executed.results.map((response, index) =>
    mapTransportResult(
      response,
      input.formatGatewayResult,
      compiled[index] ?? compiled[0]!
    )
  );
  const failed = firstFailedResult(results);
  if (failed?.error || !executed.committed) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_FAILED",
      failed?.error?.message ?? "Atomic transaction failed",
      {
        backend: capabilities.backend,
        committed: executed.committed,
        transactionId: executed.transactionId ?? null,
      }
    );
  }
  const cache =
    input.cache ?? getTransactionCacheObserver(input.gateway);
  cache?.reconcileCommitted(compiled, results);
  return results as AthenaTransactionResults<T>;
}

export interface InteractiveTransactionSession {
  abort(): void;
  capabilities: AthenaTransactionCapabilities;
  doomed: boolean;
  execute(
    operation: AthenaTransactionOperation
  ): Promise<AthenaGatewayResponse<unknown>>;
  failure: AthenaTransactionError | undefined;
  markFailed(error: AthenaTransactionError): void;
  savepointIndex: number;
  transport: AthenaInteractiveTransactionTransport;
}

export async function beginInteractiveSession(input: {
  gateway: AthenaGatewayClient;
  options?: AthenaTransactionOptions;
}): Promise<InteractiveTransactionSession> {
  const { capabilities, transport } = getTransactionTransport(input.gateway);
  if (!(transport?.beginInteractive && capabilities.interactive)) {
    throw new AthenaTransactionError(
      "ATHENA_TRANSACTION_INTERACTIVE_UNSUPPORTED",
      `Interactive transactions are not supported by backend "${capabilities.backend}"`,
      {
        backend: capabilities.backend,
        requested: "interactive",
        suggestion: "use db.transaction([...])",
        supported: capabilities.atomic ? "atomic" : "none",
      }
    );
  }
  const pinned = await pinTransactionCallOptions(
    input.gateway,
    input.options?.signal
  );
  rejectOperationContextOverride(pinned, pinned);
  const resolved = resolveTransactionOptions(
    capabilities,
    input.options,
    pinned
  );
  const interactive = await transport.beginInteractive(resolved);
  const session: InteractiveTransactionSession = {
    abort() {
      session.markFailed(
        new AthenaTransactionError(
          "ATHENA_TRANSACTION_ABORTED",
          "Transaction aborted",
          { backend: capabilities.backend }
        )
      );
    },
    capabilities,
    doomed: false,
    async execute(operation) {
      if (session.doomed) {
        throw (
          session.failure ??
          new AthenaTransactionError(
            "ATHENA_TRANSACTION_DOOMED",
            "Transaction is doomed and will roll back",
            { backend: capabilities.backend }
          )
        );
      }
      const response = await interactive.execute(operation);
      if (!response.ok) {
        session.markFailed(
          new AthenaTransactionError(
            "ATHENA_TRANSACTION_FAILED",
            response.error ?? "Transaction operation failed",
            {
              backend: capabilities.backend,
              operationId: operation.id,
              operationIndex: operation.index,
            }
          )
        );
      }
      return response;
    },
    failure: undefined,
    markFailed(error) {
      session.doomed = true;
      session.failure ??= error;
    },
    savepointIndex: 0,
    transport: interactive,
  };
  return session;
}

export async function finishInteractiveSession(input: {
  cache?: AthenaTransactionCacheObserver;
  committedOperations: AthenaTransactionOperation[];
  committedResults: AthenaResult<unknown>[];
  session: InteractiveTransactionSession;
}): Promise<void> {
  const { session } = input;
  if (session.doomed) {
    await session.transport.rollback();
    throw (
      session.failure ??
      new AthenaTransactionError(
        "ATHENA_TRANSACTION_DOOMED",
        "Transaction rolled back",
        { backend: session.capabilities.backend }
      )
    );
  }
  await session.transport.commit();
  input.cache?.reconcileCommitted(
    input.committedOperations,
    input.committedResults
  );
}
