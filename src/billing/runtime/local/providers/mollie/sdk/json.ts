import type { BillingResolvedCredential } from "../../../../credentials.ts";
import { createMollieProviderRequestError } from "../errors.ts";
import { invokeMollieSdk } from "./invoke.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function sendMollieJson(input: {
  apiBaseUrl: string;
  body: Record<string, unknown>;
  credential: BillingResolvedCredential;
  idempotencyKey?: string;
  method: "PATCH" | "POST";
  operation: string;
  path: string;
  signal?: AbortSignal;
}): Promise<unknown> {
  const url = `${input.apiBaseUrl.replace(/\/$/, "")}${input.path}`;
  const headers: Record<string, string> = {
    Accept: "application/hal+json",
    Authorization: `Bearer ${input.credential.revealForProviderRuntime()}`,
    "Content-Type": "application/json",
  };
  if (input.idempotencyKey != null && input.idempotencyKey.trim() !== "") {
    headers["idempotency-key"] = input.idempotencyKey;
  }
  return invokeMollieSdk({
    idempotencyKeyPresent:
      input.idempotencyKey != null && input.idempotencyKey.trim() !== "",
    invoke: async () => {
      const response = await fetch(url, {
        body: JSON.stringify(input.body),
        headers,
        method: input.method,
        signal: input.signal,
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        parsed = { detail: text };
      }
      if (!response.ok) {
        throw createMollieProviderRequestError({
          body: parsed,
          fallbackMessage: `Mollie ${input.operation} failed.`,
          idempotencyKeyPresent:
            input.idempotencyKey != null && input.idempotencyKey.trim() !== "",
          operation: input.operation,
          requestDispatchState: "dispatched",
          status: response.status,
        });
      }
      if (!(isRecord(parsed) || Array.isArray(parsed))) {
        throw createMollieProviderRequestError({
          fallbackMessage: `Mollie ${input.operation} returned a non-object body.`,
          kind: "serialization",
          operation: input.operation,
          requestDispatchState: "dispatched",
          status: response.status,
        });
      }
      return parsed;
    },
    operation: input.operation,
  });
}
