import { createHash } from "node:crypto";

export function fingerprintBillingSigningSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex").slice(0, 16);
}

/**
 * Mollie `POST /v2/webhooks` rejects overlong `name` with 422
 * "Name provided is too long". The API does not publish maxLength;
 * 40 was too high (compact `athena:{digest}:billing` is 31 and still 422).
 */
export const MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX = 30;

export function billingWebhookOwnershipMarker(input: {
  applicationId: string;
  connectionId: string;
}): string {
  const full = `athena:${input.applicationId}:${input.connectionId}:billing`;
  if (full.length <= MOLLIE_WEBHOOK_OWNERSHIP_NAME_MAX) {
    return full;
  }
  const digest = createHash("sha256")
    .update(`${input.applicationId}\0${input.connectionId}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `athena:${digest}`;
}

export function isAthenaOwnedWebhookName(
  name: string | undefined,
  marker: string
): boolean {
  if (name == null || name.length === 0) {
    return false;
  }
  return name === marker || name.startsWith(`${marker}:`);
}
