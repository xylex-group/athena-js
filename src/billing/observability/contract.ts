export type AthenaBillingMutationKind =
  | "action"
  | "create"
  | "delete"
  | "update";

export type AthenaBillingPreviousPolicy = "none" | "optional" | "required";

export type AthenaBillingResultPolicy = "receipt" | "resource";

export interface AthenaBillingAuditSemanticContract {
  previous: AthenaBillingPreviousPolicy;
  result: AthenaBillingResultPolicy;
}
