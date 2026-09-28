import type { AthenaClientInternals } from "../../../runtime/client-internals.ts";

export type ProduceBillingInspectorInput = {
  config: Record<string, unknown>;
  internals?: AthenaClientInternals;
};
