import { ATHENA_BILLING_ERROR_DESCRIPTORS } from "../../runtime/error/generated/billing.ts";

export const ATHENA_BILLING_IMPORT_CONFLICT =
  "ATHENA_BILLING_IMPORT_CONFLICT" as const;
export const ATHENA_BILLING_IMPORT_AMBIGUOUS_SUBJECT =
  "ATHENA_BILLING_IMPORT_AMBIGUOUS_SUBJECT" as const;
export const ATHENA_BILLING_IMPORT_PROVIDER_FAILED =
  "ATHENA_BILLING_IMPORT_PROVIDER_FAILED" as const;
export const ATHENA_BILLING_IMPORT_SUBJECT_NOT_FOUND =
  "ATHENA_BILLING_IMPORT_SUBJECT_NOT_FOUND" as const;
export const ATHENA_BILLING_IMPORT_BINDING_CONFLICT =
  "ATHENA_BILLING_IMPORT_BINDING_CONFLICT" as const;
export const ATHENA_BILLING_IMPORT_CURSOR_INVALID =
  "ATHENA_BILLING_IMPORT_CURSOR_INVALID" as const;

export type AthenaBillingImportErrorCode =
  | typeof ATHENA_BILLING_IMPORT_CONFLICT
  | typeof ATHENA_BILLING_IMPORT_AMBIGUOUS_SUBJECT
  | typeof ATHENA_BILLING_IMPORT_PROVIDER_FAILED
  | typeof ATHENA_BILLING_IMPORT_SUBJECT_NOT_FOUND
  | typeof ATHENA_BILLING_IMPORT_BINDING_CONFLICT
  | typeof ATHENA_BILLING_IMPORT_CURSOR_INVALID;

const IR_BY_CONSTANT: Record<AthenaBillingImportErrorCode, string> = {
  ATHENA_BILLING_IMPORT_AMBIGUOUS_SUBJECT: "billing_import_ambiguous_subject",
  ATHENA_BILLING_IMPORT_BINDING_CONFLICT: "billing_import_binding_conflict",
  ATHENA_BILLING_IMPORT_CONFLICT: "billing_import_conflict",
  ATHENA_BILLING_IMPORT_CURSOR_INVALID: "billing_import_cursor_invalid",
  ATHENA_BILLING_IMPORT_PROVIDER_FAILED: "billing_import_provider_failed",
  ATHENA_BILLING_IMPORT_SUBJECT_NOT_FOUND: "billing_import_subject_not_found",
};

export class AthenaBillingImportError extends Error {
  readonly code: AthenaBillingImportErrorCode;
  readonly errorNumber: number;
  readonly status: number;

  constructor(input: { code: AthenaBillingImportErrorCode; message: string }) {
    super(input.message);
    this.name = "AthenaBillingImportError";
    this.code = input.code;
    const ir = ATHENA_BILLING_ERROR_DESCRIPTORS.find(
      (entry) => entry.code === IR_BY_CONSTANT[input.code]
    );
    this.errorNumber = ir?.errorNumber ?? 4015;
    this.status = ir?.status ?? 409;
  }
}
