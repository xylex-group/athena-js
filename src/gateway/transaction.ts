import type {
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
} from "./types.ts";
import { AthenaTransactionError } from "../db/transaction/errors.ts";
import type {
  AthenaResolvedTransactionOptions,
  AthenaTransactionCapabilities,
  AthenaTransactionOperation,
  AthenaTransactionTransport,
  AthenaTransactionTransportResult,
} from "../db/transaction/types.ts";
import { GATEWAY_POSTGRES_TRANSACTION_CAPABILITIES } from "../db/transaction/types.ts";

export interface GatewayTransactionHttpCaller {
  (
    payload: unknown,
    options?: AthenaGatewayCallOptions
  ): Promise<AthenaGatewayResponse<unknown>>;
}

function asResults(
  raw: unknown
): AthenaGatewayResponse<unknown>[] | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const results = record.results;
  if (!Array.isArray(results)) {
    return undefined;
  }
  return results.map((item) => {
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const ok = row.ok !== false && !row.error;
      return {
        count: typeof row.count === "number" ? row.count : null,
        data: (row.data ?? null) as unknown,
        error: typeof row.error === "string" ? row.error : undefined,
        errorDetails: null,
        ok,
        raw: item,
        status: typeof row.status === "number" ? row.status : ok ? 200 : 400,
        statusText: ok ? "OK" : null,
      };
    }
    return {
      count: null,
      data: item,
      error: undefined,
      errorDetails: null,
      ok: true,
      raw: item,
      status: 200,
      statusText: "OK",
    };
  });
}

export function createGatewayHttpTransactionTransport(input: {
  capabilities?: AthenaTransactionCapabilities;
  postTransaction: GatewayTransactionHttpCaller;
}): AthenaTransactionTransport {
  const capabilities =
    input.capabilities ?? GATEWAY_POSTGRES_TRANSACTION_CAPABILITIES;
  return {
    capabilities,
    async executeAtomic(
      operations: readonly AthenaTransactionOperation[],
      options?: AthenaResolvedTransactionOptions
    ): Promise<AthenaTransactionTransportResult> {
      if (!capabilities.atomic) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_ATOMIC_UNSUPPORTED",
          `Atomic transactions are not supported by backend "${capabilities.backend}"`,
          { backend: capabilities.backend }
        );
      }
      const response = await input.postTransaction(
        {
          idempotency_key: options?.idempotencyKey ?? null,
          operations: operations.map((operation) => ({
            id: operation.id,
            kind: operation.kind,
            payload: operation.payload,
          })),
          options: {
            deferrable: options?.deferrable ?? false,
            isolation_level: options?.isolationLevel ?? null,
            read_only: options?.readOnly ?? false,
          },
        },
        options?.callOptions
      );
      if (!response.ok) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_FAILED",
          response.error ?? "Gateway transaction failed",
          {
            backend: capabilities.backend,
            status: response.status,
          }
        );
      }
      const results = asResults(response.raw) ?? asResults(response.data);
      if (!results || results.length !== operations.length) {
        throw new AthenaTransactionError(
          "ATHENA_TRANSACTION_FAILED",
          "Gateway transaction response did not include positional results",
          { backend: capabilities.backend }
        );
      }
      const committed =
        response.data &&
        typeof response.data === "object" &&
        "committed" in (response.data as object)
          ? Boolean((response.data as { committed?: unknown }).committed)
          : results.every((result) => result.ok);
      return { committed, results };
    },
  };
}
