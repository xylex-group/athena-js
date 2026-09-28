export function resolveBillingWebhookMasterKey(input: {
  configured?: string;
  databaseUrl?: string;
}): string | undefined {
  const fromEnv = process.env.ATHENA_BILLING_WEBHOOK_MASTER_KEY?.trim();
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  const configured = input.configured?.trim();
  if (configured && configured.length > 0) {
    return configured;
  }
  const allowTestKey =
    process.env.NODE_ENV !== "production" &&
    process.env.ATHENA_BILLING_ALLOW_TEST_WEBHOOK_KEY === "1";
  if (allowTestKey) {
    return "athena-billing-webhook-test-master-key";
  }
}
