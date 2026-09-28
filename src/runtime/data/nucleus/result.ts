import type { AthenaGatewayResponse } from "../../../gateway/types.ts";

/** Bounded mutation result. Never the full backend row set. */
export type AthenaDataMutationResult = {
  readonly affectedRows?: number;
  readonly ok: boolean;
  readonly status?: number;
};

export function acceptedDataMutationResult(
  response: AthenaGatewayResponse<unknown>
): boolean {
  return response.ok === true;
}

export function boundDataMutationResult(
  response: AthenaGatewayResponse<unknown>
): AthenaDataMutationResult {
  return Object.freeze({
    ok: response.ok === true,
    ...(typeof response.count === "number"
      ? { affectedRows: response.count }
      : {}),
    ...(typeof response.status === "number" ? { status: response.status } : {}),
  });
}
