import type { AthenaTransactionTransport } from "../db/transaction/types.ts";
import type { AthenaSelectQueryAst } from "../query/engine/ast.ts";
import type { AthenaFindManyAstPayload } from "../query-transport.ts";
import type { AthenaSelectShape } from "../query-ast.ts";
import type {
  AthenaDeletePayload,
  AthenaFetchPayload,
  AthenaGatewayCallOptions,
  AthenaGatewayConnectionOptions,
  AthenaGatewayConnectionResult,
  AthenaInsertPayload,
  AthenaQueryPayload,
  AthenaRpcCallOptions,
  AthenaRpcPayload,
  AthenaUpdatePayload,
  AthenaGatewayResponse,
} from "./types.ts";

export interface AthenaGatewayAdapter {
  baseUrl: string;
  buildHeaders: (options?: AthenaGatewayCallOptions) => Record<string, string>;
  deleteGateway: <T>(
    payload: AthenaDeletePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  fetchGateway: <T>(
    payload:
      | AthenaFetchPayload
      | AthenaFindManyAstPayload<Record<string, unknown>, AthenaSelectShape>
      | AthenaSelectQueryAst,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  insertGateway: <T>(
    payload: AthenaInsertPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  queryGateway: <T>(
    payload: AthenaQueryPayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  resolveCallOptions: (
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayCallOptions | undefined>;
  rpcGateway: <T>(
    payload: AthenaRpcPayload,
    options?: AthenaRpcCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  transactions?: AthenaTransactionTransport;
  updateGateway: <T>(
    payload: AthenaUpdatePayload,
    options?: AthenaGatewayCallOptions
  ) => Promise<AthenaGatewayResponse<T>>;
  verifyConnection: (
    options?: AthenaGatewayConnectionOptions
  ) => Promise<AthenaGatewayConnectionResult>;
}

/** Compatibility name retained while adapters migrate to the contract name. */
export type AthenaGatewayClient = AthenaGatewayAdapter;
