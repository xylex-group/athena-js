/**
 * Recurring customer enroll (`enabled`) and plan change (`planChange`).
 * Boolean `true` enables enroll only; `planChange` must be the object flag.
 */
export interface BillingSelfEnrollmentConfig {
  enabled?: boolean;
  planChange?: boolean;
}

export type BillingSelfEnrollmentSetting =
  | BillingSelfEnrollmentConfig
  | boolean
  | null
  | undefined;

/**
 * Recurring self-enrollment kill switch. Every environment stays off unless
 * `billing.selfEnrollment.enabled` is explicitly true. One-time checkout,
 * invoices, current subscription display, and cancellation are unaffected.
 */
export function isBillingSelfEnrollmentEnabled(
  config?: BillingSelfEnrollmentSetting
): boolean {
  if (config === true) {
    return true;
  }
  if (config === false) {
    return false;
  }
  if (config != null && typeof config === "object") {
    return config.enabled === true;
  }
  return false;
}

/**
 * Recurring `self.subscription.change` stays off unless
 * `billing.selfEnrollment.planChange` is explicitly true. Compensation
 * and version fencing must stay GREEN before enabling.
 */
export function isBillingSelfPlanChangeEnabled(
  config?: BillingSelfEnrollmentSetting
): boolean {
  if (config != null && typeof config === "object") {
    return config.planChange === true;
  }
  return false;
}
