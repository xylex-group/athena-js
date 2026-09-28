import type { AthenaGatewayErrorCode } from "../gateway/types.ts";
import type { AthenaErrorKind } from "./types.ts";

export function classifyAthenaError(
  status: number | undefined,
  code: AthenaGatewayErrorCode | undefined,
  message: string
): AthenaErrorKind {
  const lower = message.toLowerCase();
  if (
    status === 409 ||
    lower.includes("unique constraint") ||
    lower.includes("duplicate key") ||
    lower.includes("already exists") ||
    lower.includes("duplicate")
  ) {
    return "unique_violation";
  }
  if (status === 404 || lower.includes("not found") || lower.includes("no rows")) {
    return "not_found";
  }
  if (
    status === 401 ||
    status === 403 ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("auth")
  ) {
    return "auth";
  }
  if (
    status === 429 ||
    lower.includes("rate limit") ||
    lower.includes("too many requests")
  ) {
    return "rate_limit";
  }
  if (
    code === "INVALID_URL" ||
    status === 400 ||
    status === 422 ||
    lower.includes("validation") ||
    lower.includes("invalid") ||
    lower.includes("malformed")
  ) {
    return "validation";
  }
  if (
    code === "NETWORK_ERROR" ||
    status === 0 ||
    (status !== undefined && status >= 500) ||
    lower.includes("timeout") ||
    lower.includes("temporar") ||
    lower.includes("connection reset") ||
    lower.includes("socket") ||
    lower.includes("deadlock")
  ) {
    return "transient";
  }
  return "unknown";
}
