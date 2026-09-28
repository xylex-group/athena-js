export const BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_STATES = [
  "provider_registration_pending",
  "provider_registered_secret_pending",
  "secret_persisted_activation_pending",
  "verification_pending",
  "active",
  "rotation_pending",
  "rotation_secret_pending",
  "attention_required",
  "failed",
  "verification_failed",
] as const;

export type BillingWebhookRegistrationLifecycleState =
  (typeof BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_STATES)[number];

export function isBillingWebhookRegistrationLifecycleState(
  value: string
): value is BillingWebhookRegistrationLifecycleState {
  return (
    BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_STATES as readonly string[]
  ).includes(value);
}

export const BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_TRANSITIONS: Readonly<
  Record<
    BillingWebhookRegistrationLifecycleState,
    readonly BillingWebhookRegistrationLifecycleState[]
  >
> = {
  active: ["rotation_pending", "attention_required", "failed"],
  attention_required: [],
  failed: [],
  provider_registered_secret_pending: [
    "secret_persisted_activation_pending",
    "rotation_pending",
    "attention_required",
    "failed",
  ],
  provider_registration_pending: [
    "provider_registered_secret_pending",
    "rotation_pending",
    "attention_required",
    "failed",
  ],
  rotation_pending: [
    "rotation_secret_pending",
    "secret_persisted_activation_pending",
    "attention_required",
    "failed",
  ],
  rotation_secret_pending: [
    "secret_persisted_activation_pending",
    "active",
    "attention_required",
    "failed",
  ],
  secret_persisted_activation_pending: [
    "verification_pending",
    "attention_required",
    "failed",
  ],
  verification_failed: ["verification_pending", "attention_required"],
  verification_pending: ["active", "verification_failed", "attention_required"],
};

export function billingWebhookRegistrationLifecycle(input: {
  providerRegistered: boolean;
  secretPersisted: boolean;
  verificationPassed: boolean;
}): BillingWebhookRegistrationLifecycleState {
  if (!input.providerRegistered) {
    return "provider_registration_pending";
  }
  if (!input.secretPersisted) {
    return "provider_registered_secret_pending";
  }
  if (!input.verificationPassed) {
    return "verification_pending";
  }
  return "active";
}

export function assertBillingWebhookRegistrationLifecycle(
  current: BillingWebhookRegistrationLifecycleState,
  input: { hasSecret: boolean; next: BillingWebhookRegistrationLifecycleState }
): void {
  if (input.next === "active" && !input.hasSecret) {
    throw new Error(
      "Webhook registration cannot become active without durable secret material."
    );
  }
  if (current === input.next) {
    return;
  }
  if (
    !BILLING_WEBHOOK_REGISTRATION_LIFECYCLE_TRANSITIONS[current].includes(
      input.next
    )
  ) {
    throw new Error(
      `Illegal webhook registration lifecycle transition: ${current} -> ${input.next}.`
    );
  }
}
