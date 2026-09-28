export const ATHENA_BILLING_RETURN_QUERY = "athena_billing_return";

export function appendBillingReturnToken(url: string, token: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set(ATHENA_BILLING_RETURN_QUERY, token);
  return parsed.href;
}
