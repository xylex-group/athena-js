import type { BillingResolvedCredential } from "../../../credentials.ts";
import { callMollieSdk, clientFromPool } from "./sdk/call.ts";
import type { MollieSdkClientPool } from "./sdk/client-factory.ts";

export async function resolveMollieWebhookResource(input: {
  credential: BillingResolvedCredential;
  id: string;
  kind: "payment" | "subscription" | "invoice";
  operationScope?: "organization" | "profile" | "automatic";
  pool: MollieSdkClientPool;
  profileId?: string | null;
}): Promise<unknown> {
  const client = clientFromPool(input.pool, {
    credential: input.credential,
    operationScope: input.operationScope,
    target: { profileId: input.profileId },
  });
  if (input.kind === "subscription") {
    return callMollieSdk({
      client,
      method: "get",
      operation: "subscriptions.get",
      request: { subscriptionId: input.id },
      resource: "subscriptions",
    });
  }
  if (input.kind === "invoice") {
    return callMollieSdk({
      client,
      method: "get",
      operation: "invoices.get",
      request: { invoiceId: input.id },
      resource: "invoices",
    });
  }
  return callMollieSdk({
    client,
    method: "get",
    operation: "payments.get",
    request: { paymentId: input.id },
    resource: "payments",
  });
}
