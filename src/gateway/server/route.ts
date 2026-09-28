import type { AthenaRuntimeOperation } from "../../runtime/data/types.ts";
import { ATHENA_GATEWAY_ROUTES } from "../routes.ts";

export type AthenaGatewayServerRoute =
  | { kind: "gateway"; operation: AthenaRuntimeOperation }
  | { kind: "health" }
  | { kind: "capabilities" }
  | { kind: "devtools-events" }
  | { kind: "devtools-stream" }
  | { kind: "unknown" };

const GATEWAY_OPERATIONS: ReadonlyArray<{
  operation: AthenaRuntimeOperation;
  path: string;
}> = [
  { operation: "fetch", path: ATHENA_GATEWAY_ROUTES.select },
  { operation: "insert", path: ATHENA_GATEWAY_ROUTES.insert },
  { operation: "update", path: ATHENA_GATEWAY_ROUTES.update },
  { operation: "delete", path: ATHENA_GATEWAY_ROUTES.delete },
  { operation: "query", path: ATHENA_GATEWAY_ROUTES.rawQuery },
  { operation: "rpc", path: ATHENA_GATEWAY_ROUTES.rpc },
];

export function resolveAthenaGatewayServerRoute(
  pathname: string
): AthenaGatewayServerRoute {
  const normalized =
    pathname.endsWith("/") && pathname.length > 1
      ? pathname.slice(0, -1)
      : pathname;

  if (normalized === "/health" || normalized.endsWith("/health")) {
    return { kind: "health" };
  }
  if (normalized === "/capabilities" || normalized.endsWith("/capabilities")) {
    return { kind: "capabilities" };
  }
  if (
    normalized === "/api/athena/devtools/v1/events" ||
    normalized.endsWith("/devtools/v1/events")
  ) {
    return { kind: "devtools-events" };
  }
  if (
    normalized === "/api/athena/devtools/v1/stream" ||
    normalized.endsWith("/devtools/v1/stream")
  ) {
    return { kind: "devtools-stream" };
  }

  for (const entry of GATEWAY_OPERATIONS) {
    if (normalized === entry.path || normalized.endsWith(entry.path)) {
      return { kind: "gateway", operation: entry.operation };
    }
  }

  return { kind: "unknown" };
}
