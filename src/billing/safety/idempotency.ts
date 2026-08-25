export function assertBillingIdempotencyKey(
	key: unknown,
): asserts key is string {
	if (typeof key !== "string" || key.trim() === "") {
		throw new Error("ATHENA_BILLING_IDEMPOTENCY_KEY_REQUIRED");
	}
}
