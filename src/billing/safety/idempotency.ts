const MAX_IDEMPOTENCY_KEY_LENGTH = 64;
const FORBIDDEN_IDEMPOTENCY_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}\\s]`
);

export function assertBillingIdempotencyKey(
  key: unknown
): asserts key is string {
  if (typeof key !== "string" || key.trim() === "") {
    throw new Error("ATHENA_BILLING_IDEMPOTENCY_KEY_REQUIRED");
  }
  const normalized = key.trim();
  if (
    normalized.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    FORBIDDEN_IDEMPOTENCY_CHARS.test(normalized)
  ) {
    throw new Error("ATHENA_BILLING_IDEMPOTENCY_KEY_INVALID");
  }
}
