import type { NotificationsGatewayRequest } from "./module.ts";
import { unwrapNotificationsGatewayResult } from "./module.ts";

export const DEFAULT_NOTIFICATIONS_HTTP_PATH = "/api/athena/notifications";

export function createNotificationsEmbeddedHttpRequest(options?: {
  fetch?: typeof fetch;
  path?: string;
}): NotificationsGatewayRequest {
  const path = options?.path ?? DEFAULT_NOTIFICATIONS_HTTP_PATH;
  const fetchImpl = options?.fetch ?? fetch;
  return async (input) => {
    const response = await fetchImpl(path, {
      body: JSON.stringify(input.body ?? {}),
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
    });
    const json: unknown = await response.json().catch(() => undefined);
    const record =
      json !== null && typeof json === "object" && !Array.isArray(json)
        ? (json as { data?: unknown; ok?: boolean; status?: number })
        : {};
    return unwrapNotificationsGatewayResult({
      data: record.data,
      ok: record.ok === true && response.ok,
      status:
        typeof record.status === "number" ? record.status : response.status,
    });
  };
}
