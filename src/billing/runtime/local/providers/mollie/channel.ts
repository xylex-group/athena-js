export const MOLLIE_WEBHOOK_CLASSIC_OPERATION = "webhook.mollie.classic";
export const MOLLIE_WEBHOOK_EVENTS_OPERATION = "webhook.mollie.events";

export type MollieWebhookChannel =
  | {
      kind: "classic";
      operation: typeof MOLLIE_WEBHOOK_CLASSIC_OPERATION;
      verification: "authoritative_refetch";
    }
  | {
      kind: "next_gen";
      operation: typeof MOLLIE_WEBHOOK_EVENTS_OPERATION;
      verification: "signature_and_refetch";
    };

export function mollieWebhookChannel(
  operation: string
): MollieWebhookChannel | undefined {
  if (operation === MOLLIE_WEBHOOK_EVENTS_OPERATION) {
    return {
      kind: "next_gen",
      operation: MOLLIE_WEBHOOK_EVENTS_OPERATION,
      verification: "signature_and_refetch",
    };
  }
  if (
    operation === MOLLIE_WEBHOOK_CLASSIC_OPERATION ||
    operation === "webhook"
  ) {
    return {
      kind: "classic",
      operation: MOLLIE_WEBHOOK_CLASSIC_OPERATION,
      verification: "authoritative_refetch",
    };
  }
}

export function requireMollieWebhookChannel(
  operation: string
): MollieWebhookChannel {
  const channel = mollieWebhookChannel(operation);
  if (channel == null) {
    throw new Error(
      `Mollie webhook channel is not bound to operation "${operation}".`
    );
  }
  return channel;
}
