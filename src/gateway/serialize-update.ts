import type {
  AthenaFetchPayload,
  AthenaInsertPayload,
  AthenaUpdatePayload,
  AthenaDeletePayload,
} from "./types.ts";
import type { AthenaTransactionOperation } from "../db/transaction/types.ts";

export type AthenaGatewayUpdateRequestBody<
  TUpdateBody = AthenaUpdatePayload["update_body"],
> = Omit<AthenaUpdatePayload<TUpdateBody>, "update_body"> & {
  data: TUpdateBody;
};

/**
 * Projects the semantic update payload onto the Rust Gateway wire contract.
 * `update_body` remains the internal representation used by query builders and
 * direct SQL compilers.
 */
export function serializeGatewayUpdateRequest<TUpdateBody>(
  payload: AthenaUpdatePayload<TUpdateBody>
): AthenaGatewayUpdateRequestBody<TUpdateBody> {
  const { update_body, ...rest } = payload;
  return {
    ...rest,
    data: update_body,
  };
}

export function serializeGatewayOperation(
  operation: AthenaTransactionOperation
): {
  id: string;
  kind: AthenaTransactionOperation["kind"];
  payload:
    | AthenaFetchPayload
    | AthenaInsertPayload
    | AthenaUpdatePayload["update_body"]
    | AthenaDeletePayload
    | AthenaGatewayUpdateRequestBody;
} {
  if (operation.kind === "update") {
    return {
      id: operation.id,
      kind: operation.kind,
      payload: serializeGatewayUpdateRequest(operation.payload),
    };
  }

  return {
    id: operation.id,
    kind: operation.kind,
    payload: operation.payload,
  };
}
