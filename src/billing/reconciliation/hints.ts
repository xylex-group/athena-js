import type { BillingOperation } from "../runtime/capabilities.ts";

export type BillingReconciliationHint =
  | {
      kind: "get_parent";
      operation: BillingOperation;
      parentId: string;
    }
  | {
      kind: "list_children";
      operation: BillingOperation;
      parentId: string;
    }
  | {
      kind: "get_self";
      operation: BillingOperation;
      id: string;
    };

export function billingReconciliationHintForAmbiguousCreate(input: {
  id?: string;
  operation: BillingOperation;
  parentId?: string;
}): BillingReconciliationHint | undefined {
  if (input.parentId != null && input.parentId.trim() !== "") {
    return {
      kind: "list_children",
      operation: input.operation,
      parentId: input.parentId,
    };
  }
  if (input.id != null && input.id.trim() !== "") {
    return {
      id: input.id,
      kind: "get_self",
      operation: input.operation,
    };
  }
}
