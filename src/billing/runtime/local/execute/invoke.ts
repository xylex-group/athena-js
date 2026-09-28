import type { AthenaPrincipal } from "../../../../runtime/data/principal.ts";
import type { BillingProviderConfigMap } from "../../../providers/types.ts";
import {
  finalizeBillingCommand,
  prepareBillingCommand,
} from "../../../safety/prepare.ts";
import type { BillingExecutionTarget } from "../../../types.ts";
import type { BillingOperation } from "../../capabilities.ts";
import type { BillingInvocationAuthority } from "../../invocation-authority.ts";
import type { BillingProviderRegistry } from "../providers/registry.ts";
import type {
  BillingProviderExecutionContext,
  BillingProviderPortMap,
  BillingProviderPortName,
} from "../providers/types.ts";
import {
  prepareLocalBillingInvocation,
  requireProviderPort,
} from "./shared.ts";

export interface LocalBillingExecutorRequest<TPayload> {
  authority: BillingInvocationAuthority;
  configuredProviders?: BillingProviderConfigMap;
  payload: TPayload;
  principal?: AthenaPrincipal;
  registry: BillingProviderRegistry;
  testMode?: boolean;
}

export async function executeLocalBillingOperation<
  TPayload,
  TResult,
  TPort extends BillingProviderPortName,
>(input: {
  before?: (payload: TPayload) => void;
  invoke: (
    port: NonNullable<BillingProviderPortMap[TPort]>,
    context: BillingProviderExecutionContext,
    payload: TPayload
  ) => Promise<TResult> | TResult;
  operation: BillingOperation;
  port: TPort;
  request: LocalBillingExecutorRequest<TPayload>;
  safety?: "enforce" | "defer-then-finalize";
}): Promise<TResult> {
  let payload = input.request.payload;
  const deferSafety = input.safety === "defer-then-finalize";
  const prepared = prepareBillingCommand({
    idempotency: deferSafety ? "defer" : "enforce",
    operation: input.operation,
    payload,
    testMode: input.request.testMode,
  });
  payload = prepared.payload as TPayload;
  input.before?.(payload);
  const invocation = await prepareLocalBillingInvocation({
    authority: input.request.authority,
    configuredProviders: input.request.configuredProviders,
    idempotencyKey: readIdempotencyKey(payload),
    operation: input.operation,
    principal: input.request.principal,
    registry: input.request.registry,
    target: payload as TPayload & BillingExecutionTarget,
    testMode: input.request.testMode,
  });
  if (deferSafety) {
    payload = finalizeBillingCommand({
      operation: input.operation,
      payload,
      testMode: input.request.testMode,
    }).payload as TPayload;
  }
  const ports: BillingProviderPortMap = invocation.runtime;
  const port = requireProviderPort(ports[input.port], input.operation);
  return input.invoke(port, invocation.context, payload);
}

function readIdempotencyKey(payload: unknown): string | undefined {
  if (
    payload != null &&
    typeof payload === "object" &&
    "idempotencyKey" in payload &&
    typeof payload.idempotencyKey === "string"
  ) {
    return payload.idempotencyKey;
  }
}
