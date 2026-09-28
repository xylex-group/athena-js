import { buildDataMutationInput } from "../nucleus/prepare.ts";
import { deepFreezeValue } from "../nucleus/types.ts";
import type { AthenaRuntimeRequest } from "../types.ts";
import type { AthenaDataLifecycleEvent } from "./events.ts";

export { lifecycleEventName } from "../nucleus/prepare.ts";

export function freezeAuthorizedPayload(payload: unknown): unknown {
  return deepFreezeValue(structuredClone(payload));
}

export function buildDataLifecycleEvent(
  request: AthenaRuntimeRequest
): AthenaDataLifecycleEvent | undefined {
  return buildDataMutationInput(request);
}
