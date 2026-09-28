import { createHmac, timingSafeEqual } from "node:crypto";

export const MOLLIE_WEBHOOK_MAX_BODY_BYTES = 64 * 1024;

export function verifyMollieWebhookSignature(input: {
  body: Uint8Array;
  signatureHeader?: string;
  signingSecrets: readonly string[];
}): boolean {
  if (input.body.byteLength > MOLLIE_WEBHOOK_MAX_BODY_BYTES) {
    return false;
  }
  const header = input.signatureHeader?.trim();
  if (!header || input.signingSecrets.length === 0) {
    return false;
  }
  const providedHeaders = header
    .split(/[\n,]/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  for (const candidate of providedHeaders) {
    const provided = candidate.startsWith("sha256=")
      ? candidate.slice(7)
      : candidate;
    const providedBytes = decodeMollieWebhookSignatureHex(provided);
    if (providedBytes == null) {
      continue;
    }
    for (const secret of input.signingSecrets) {
      const calculated = createHmac("sha256", secret)
        .update(input.body)
        .digest();
      if (
        calculated.length === providedBytes.length &&
        timingSafeEqual(calculated, providedBytes)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Mollie next-gen `X-Mollie-Signature` is HMAC-SHA256 hex (`sha256=<hex>`). */
function decodeMollieWebhookSignatureHex(value: string): Buffer | null {
  const hex = value.trim();
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== 64) {
    return null;
  }
  return Buffer.from(hex, "hex");
}
