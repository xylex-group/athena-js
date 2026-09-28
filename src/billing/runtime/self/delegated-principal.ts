import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import type { BillingOperation } from "../capabilities.ts";
import { requiredBillingRights } from "../rights.ts";

/**
 * Process-invocation helper for self-service re-entry. Holds only the Rights
 * the listed operations need, bound to the caller's subject — never the
 * full operator overlay.
 */
export function selfDelegatedBillingPrincipal(
  subject: AthenaPrincipal,
  operations: readonly BillingOperation[]
): AthenaPrincipal {
  const rights = Object.freeze([
    ...new Set(
      operations.flatMap((operation) => requiredBillingRights(operation))
    ),
  ]);
  return {
    authenticated: true,
    grants: [],
    rights,
    ...(subject.organizationId === null
      ? {}
      : { organizationId: subject.organizationId }),
    ...(subject.sessionId === null ? {} : { sessionId: subject.sessionId }),
    ...(subject.userId === null ? {} : { userId: subject.userId }),
  };
}
