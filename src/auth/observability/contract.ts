export type AthenaAuthMutationKind = "action" | "create" | "delete" | "update";

export type AthenaAuthPreviousPolicy = "none" | "optional" | "required";

export type AthenaAuthResultPolicy = "receipt" | "resource";

export interface AthenaAuthAuditSemanticContract {
  previous: AthenaAuthPreviousPolicy;
  result: AthenaAuthResultPolicy;
}
