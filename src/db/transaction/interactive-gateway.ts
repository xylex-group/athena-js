import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayResponse,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
} from "../../gateway/types.ts";
import { AthenaTransactionError } from "./errors.ts";
import { nextTransactionOperationId } from "./compile.ts";
import type { InteractiveTransactionSession } from "./coordinator.ts";
import type { AthenaQueryDescriptor } from "../../query/descriptor.ts";
import { compileAthenaQueryDescriptor } from "../../query/descriptor.ts";
import type { AthenaTransactionOperation } from "./types.ts";

function descriptorFor(
  operation: "select" | "insert" | "update" | "delete",
  tableName: string
): AthenaQueryDescriptor {
  return compileAthenaQueryDescriptor({
    operation,
    tableName,
  });
}

function tableNameOf(payload: { table_name?: string }): string {
  return payload.table_name?.trim() || "unknown";
}

export function createInteractiveGatewayClient(
  base: AthenaGatewayClient,
  session: InteractiveTransactionSession
): AthenaGatewayClient {
  const execute = async (
    kind: AthenaTransactionOperation["kind"],
    payload:
      | AthenaFetchPayload
      | AthenaInsertPayload
      | AthenaUpdatePayload
      | AthenaDeletePayload
  ): Promise<AthenaGatewayResponse<unknown>> => {
    const table = tableNameOf(payload);
    const descriptorKind = kind === "fetch" ? "select" : kind;
    const operation: AthenaTransactionOperation = {
      descriptor: descriptorFor(descriptorKind, table),
      id: nextTransactionOperationId(),
      index: 0,
      kind,
      payload,
    } as AthenaTransactionOperation;
    return session.execute(operation);
  };

  return {
    baseUrl: base.baseUrl,
    buildHeaders(options) {
      return base.buildHeaders(options);
    },
    deleteGateway(payload: AthenaDeletePayload, _options?: AthenaGatewayCallOptions) {
      return execute("delete", payload) as Promise<AthenaGatewayResponse<never>>;
    },
    fetchGateway(payload, _options?: AthenaGatewayCallOptions) {
      return execute("fetch", payload as AthenaFetchPayload) as Promise<
        AthenaGatewayResponse<never>
      >;
    },
    insertGateway(payload: AthenaInsertPayload, _options?: AthenaGatewayCallOptions) {
      return execute("insert", payload) as Promise<AthenaGatewayResponse<never>>;
    },
    async queryGateway(
      _payload: AthenaQueryPayload,
      _options?: AthenaGatewayCallOptions
    ) {
      void _payload;
      void _options;
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
        "Raw SQL is not part of v1 interactive transactions",
        { backend: session.capabilities.backend }
      );
    },
    resolveCallOptions(options) {
      return base.resolveCallOptions(options);
    },
    async rpcGateway(
      _payload: AthenaRpcPayload,
      _options?: AthenaRpcCallOptions
    ) {
      void _payload;
      void _options;
      throw new AthenaTransactionError(
        "ATHENA_TRANSACTION_OPERATION_UNSUPPORTED",
        "RPC is not part of v1 interactive transactions",
        { backend: session.capabilities.backend }
      );
    },
    updateGateway(payload: AthenaUpdatePayload, _options?: AthenaGatewayCallOptions) {
      return execute("update", payload) as Promise<AthenaGatewayResponse<never>>;
    },
    transactions: base.transactions,
    verifyConnection(options) {
      return base.verifyConnection(options);
    },
  };
}
