export const BILLING_PLAN_CHANGE_STATES = [
  "requested",
  "claimed",
  "provider_update_pending",
  "provider_update_unknown",
  "provider_update_applied",
  "replacement_create_pending",
  "replacement_create_unknown",
  "replacement_created",
  "old_cancel_pending",
  "old_cancel_unknown",
  "old_cancelled",
  "local_commit_pending",
  "compensating",
  "compensation_pending",
  "compensation_unknown",
  "compensation_applied",
  "completed",
  "attention_required",
  "failed",
] as const;

export type BillingPlanChangeState =
  (typeof BILLING_PLAN_CHANGE_STATES)[number];

export const BILLING_PLAN_CHANGE_STATE_TRANSITIONS: Readonly<
  Record<BillingPlanChangeState, readonly BillingPlanChangeState[]>
> = {
  attention_required: [],
  claimed: ["provider_update_pending", "replacement_create_pending", "failed"],
  compensation_applied: ["failed", "attention_required"],
  compensation_pending: [
    "compensation_applied",
    "compensation_unknown",
    "attention_required",
    "failed",
  ],
  compensation_unknown: [
    "compensation_pending",
    "compensation_applied",
    "attention_required",
    "failed",
  ],
  compensating: ["compensation_pending", "attention_required", "failed"],
  completed: [],
  failed: [],
  local_commit_pending: ["completed", "attention_required", "failed"],
  old_cancel_pending: [
    "old_cancelled",
    "old_cancel_unknown",
    "compensating",
    "attention_required",
    "failed",
  ],
  old_cancel_unknown: [
    "old_cancel_pending",
    "old_cancelled",
    "compensating",
    "attention_required",
    "failed",
  ],
  old_cancelled: ["local_commit_pending", "attention_required", "failed"],
  provider_update_applied: [
    "local_commit_pending",
    "attention_required",
    "failed",
  ],
  provider_update_pending: [
    "provider_update_unknown",
    "provider_update_applied",
    "replacement_create_pending",
    "attention_required",
    "failed",
  ],
  provider_update_unknown: [
    "provider_update_pending",
    "provider_update_applied",
    "attention_required",
    "failed",
  ],
  replacement_create_pending: [
    "replacement_created",
    "replacement_create_unknown",
    "attention_required",
    "failed",
  ],
  replacement_create_unknown: [
    "replacement_create_pending",
    "replacement_created",
    "attention_required",
    "failed",
  ],
  replacement_created: ["old_cancel_pending", "attention_required", "failed"],
  requested: ["claimed", "failed"],
};

const BILLING_PLAN_CHANGE_STATE_SET = new Set<BillingPlanChangeState>(
  BILLING_PLAN_CHANGE_STATES,
);

export class BillingPlanChangeTransitionError extends Error {
  readonly code = "ATHENA_BILLING_PLAN_CHANGE_INVALID_TRANSITION";
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Illegal plan-change transition: ${from} -> ${to}.`);
    this.name = "BillingPlanChangeTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function isBillingPlanChangeState(
  value: unknown,
): value is BillingPlanChangeState {
  return (
    typeof value === "string" &&
    BILLING_PLAN_CHANGE_STATE_SET.has(value as BillingPlanChangeState)
  );
}

export function parseBillingPlanChangeState(
  value: unknown,
): BillingPlanChangeState {
  if (!isBillingPlanChangeState(value)) {
    throw new BillingPlanChangeTransitionError(String(value), "<invalid>");
  }
  return value;
}

export function canTransitionBillingPlanChange(
  from: unknown,
  to: unknown,
): boolean {
  return (
    isBillingPlanChangeState(from) &&
    isBillingPlanChangeState(to) &&
    BILLING_PLAN_CHANGE_STATE_TRANSITIONS[from].includes(to)
  );
}

export function assertBillingPlanChangeTransition(
  from: string,
  to: string,
): asserts to is BillingPlanChangeState {
  if (!canTransitionBillingPlanChange(from, to)) {
    throw new BillingPlanChangeTransitionError(from, to);
  }
}

export function transitionBillingPlanChangeState(
  from: BillingPlanChangeState,
  to: BillingPlanChangeState,
): BillingPlanChangeState {
  assertBillingPlanChangeTransition(from, to);
  return to;
}
