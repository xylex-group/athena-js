import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { billingSubjectNotFound } from "../../subject/errors.ts";
import { requireBillingPrincipalUserId } from "../../subject/principal-user.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";
import type {
  BillingSelfSubscriptionChangeOperation,
  BillingSelfSubscriptionChangeStatus,
} from "../../runtime/types.ts";
import { createBillingPlanChangeRepository } from "./plan-change-repository.ts";

function operationStatus(
  state: BillingSelfSubscriptionChangeOperation["state"]
): BillingSelfSubscriptionChangeStatus {
  if (state === "completed") {
    return "completed";
  }
  if (state === "attention_required") {
    return "attention_required";
  }
  if (state === "failed") {
    return "failed";
  }
  return "processing";
}

export async function getSelfSubscriptionChangeOperation(input: {
  operationId: string;
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingSelfSubscriptionChangeOperation> {
  const subjectId = requireBillingPrincipalUserId(input.principal);
  const operation = await createBillingPlanChangeRepository(input.sql).load(
    input.operationId
  );
  if (
    operation == null ||
    operation.subjectKind !== "user" ||
    operation.subjectId !== subjectId
  ) {
    throw billingSubjectNotFound("Plan-change operation was not found.");
  }
  return {
    ...(operation.lastError ? { error: operation.lastError } : {}),
    operationId: operation.id,
    ...(operation.priceId ? { priceId: operation.priceId } : {}),
    state: operation.state,
    status: operationStatus(operation.state),
    ...(operation.updatedAt ? { updatedAt: operation.updatedAt } : {}),
  };
}
