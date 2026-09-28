import type { AthenaResultFormatter } from "../../result/types.ts";
import type { InternalClientBehaviorOptions } from "../contracts.ts";
import type { AthenaGatewayClient } from "../../gateway/client.ts";
import type { AthenaQueryTracer } from "../../query-tracing.ts";

export interface AthenaQueryExecutionRuntime {
  gateway: AthenaGatewayClient;
  formatGatewayResult: AthenaResultFormatter;
  tracer?: AthenaQueryTracer;
  behavior?: InternalClientBehaviorOptions;
}

export function createQueryExecutionRuntime(
  runtime: AthenaQueryExecutionRuntime
): AthenaQueryExecutionRuntime {
  return Object.freeze({ ...runtime });
}
