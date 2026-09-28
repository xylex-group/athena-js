import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { AthenaBillingError } from "../errors.ts";

export function requireBillingPrincipalUserId(
  principal: AthenaPrincipal
): string {
  const userId = principal.userId?.trim();
  if (userId == null || userId.length === 0) {
    throw new AthenaBillingError({
      body: { field: "userId" },
      code: "ATHENA_BILLING_INVALID_REQUEST",
      endpoint: "",
      message: "Authenticated billing subject is required.",
      method: "POST",
      status: 400,
    });
  }
  return userId;
}
