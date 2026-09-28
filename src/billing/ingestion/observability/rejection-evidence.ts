import { createHmac } from "node:crypto";

export const BILLING_INGRESS_DIAGNOSTICS_DOMAIN =
  "athena.billing.ingress.rejection.v1";
export const MAX_CLASSIFICATION_BYTES = 4_096;

export type BillingRejectedIngressClassification =
  | "empty"
  | "form"
  | "json"
  | "text"
  | "binary"
  | "invalid";

export interface BillingRejectedIngressPayloadEvidence {
  bytes: number;
  classification: BillingRejectedIngressClassification;
  contentType?: string;
  digest?: string;
  truncated?: boolean;
}

function classify(
  body: Uint8Array,
  bodyKind: "empty" | "json" | "form" | "unknown" | undefined
): BillingRejectedIngressClassification {
  if (body.byteLength === 0) {
    return "empty";
  }
  const sample = body.slice(0, MAX_CLASSIFICATION_BYTES);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
  } catch {
    return "invalid";
  }
  if (bodyKind === "form") {
    return "form";
  }
  if (bodyKind === "json") {
    return "json";
  }
  const text = new TextDecoder().decode(sample).trim();
  if (text.length === 0) {
    return "text";
  }
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (
      codePoint !== 0x09 &&
      codePoint !== 0x0a &&
      codePoint !== 0x0d &&
      (codePoint < 0x20 || codePoint > 0x7e)
    ) {
      return "binary";
    }
  }
  return "text";
}

export function createBillingRejectedIngressEvidence(input: {
  body: Uint8Array;
  bodyKind?: "empty" | "json" | "form" | "unknown";
  contentType?: string;
  key?: string | Uint8Array;
}): BillingRejectedIngressPayloadEvidence {
  const digest =
    input.key == null
      ? undefined
      : createHmac("sha256", input.key)
          .update(BILLING_INGRESS_DIAGNOSTICS_DOMAIN)
          .update("\0")
          .update(input.body)
          .digest("hex");
  const contentType = input.contentType?.trim();
  return {
    bytes: input.body.byteLength,
    classification: classify(input.body, input.bodyKind),
    ...(digest ? { digest } : {}),
    ...(contentType ? { contentType } : {}),
    ...(input.body.byteLength > MAX_CLASSIFICATION_BYTES
      ? { truncated: true }
      : {}),
  };
}
