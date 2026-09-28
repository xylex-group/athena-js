export const PROCESS_INVOCATION_BRAND =
  "athena.billing.invocation.process" as const;

export interface BillingProcessInvocationAuthority {
  readonly brand: typeof PROCESS_INVOCATION_BRAND;
  readonly kind: "process";
}

export interface BillingSessionInvocationAuthority {
  readonly kind: "session";
}

export type BillingInvocationAuthority =
  | BillingProcessInvocationAuthority
  | BillingSessionInvocationAuthority;

export const PROCESS_BILLING_INVOCATION: BillingProcessInvocationAuthority =
  Object.freeze({
    brand: PROCESS_INVOCATION_BRAND,
    kind: "process",
  });

export const SESSION_BILLING_INVOCATION: BillingSessionInvocationAuthority =
  Object.freeze({
    kind: "session",
  });

export function isProcessBillingInvocation(
  authority: BillingInvocationAuthority | { readonly kind?: string } | undefined
): authority is BillingProcessInvocationAuthority {
  return (
    authority != null &&
    authority.kind === "process" &&
    "brand" in authority &&
    (authority as BillingProcessInvocationAuthority).brand ===
      PROCESS_INVOCATION_BRAND
  );
}

/**
 * Process invocation is sealed. `{ kind: "process" }` without the brand is
 * ignored. Omitted authority is session (least privilege). Operator Node
 * runtimes must pass `PROCESS_BILLING_INVOCATION` explicitly.
 */
export function resolveBillingInvocationAuthority(input: {
  authority?: BillingInvocationAuthority | { readonly kind?: string };
}): BillingInvocationAuthority {
  if (isProcessBillingInvocation(input.authority)) {
    return PROCESS_BILLING_INVOCATION;
  }
  return SESSION_BILLING_INVOCATION;
}
