import type { AthenaPrincipal } from "../../runtime/data/principal.ts";
import { AthenaBillingCapabilityError } from "../errors.ts";
import type { BillingProviderConfigMap } from "../providers/types.ts";
import { PROCESS_BILLING_INVOCATION } from "../runtime/invocation-authority.ts";
import { executeLocalBillingCustomerCreate } from "../runtime/local/execute/customers.ts";
import type { BillingProviderRegistry } from "../runtime/local/providers/registry.ts";
import { selfDelegatedBillingPrincipal } from "../runtime/self/delegated-principal.ts";
import type { BillingCustomer } from "../types.ts";
import {
  billingConfiguredConnectionOwner,
  configuredProvidersForBillingConnection,
  resolveBillingConnectionAffinity,
} from "./connection-affinity.ts";
import {
  createVerifiedBillingContact,
  type VerifiedBillingContact,
} from "./contact.ts";
import {
  createPostgresBillingSubjectRepository,
  isBillingUniqueViolation,
  subjectFromPrincipalUser,
} from "./postgres.ts";
import { requireBillingPrincipalUserId } from "./principal-user.ts";
import type {
  BillingSqlExecutor,
  BillingSubjectBindingRecord,
} from "./repository.ts";

function isPlaceholderProviderId(value: string): boolean {
  return value.startsWith("reserve:");
}

function usableProviderCustomer(
  bindings: readonly BillingSubjectBindingRecord[]
): BillingSubjectBindingRecord | undefined {
  return bindings.find(
    (binding) =>
      binding.providerSubjectKind === "customer" &&
      binding.status === "active" &&
      !isPlaceholderProviderId(binding.providerSubjectId)
  );
}

async function verifiedBillingContact(input: {
  now?: () => Date;
  sql: BillingSqlExecutor;
  subjectId: string;
}): Promise<VerifiedBillingContact | undefined> {
  const result = await input.sql.query(
    `SELECT id, email, email_verified
     FROM athena.users
     WHERE id = $1
     LIMIT 1`,
    [input.subjectId],
  );
  const row = result.rows[0];
  if (
    !row ||
    typeof row.email !== "string" ||
    row.email_verified !== true
  ) {
    return undefined;
  }
  const verifiedEmailObservedAt = (input.now ?? (() => new Date()))();
  return createVerifiedBillingContact({
    email: row.email,
    source: "athena-auth",
    subjectId: input.subjectId,
    verifiedEmailObservedAt,
  });
}

/**
 * Ensure an active provider customer exists for the Athena subject.
 * Binding keys are subject_kind + subject_id. Email is never identity.
 * Concurrent callers serialize on the live unique index: only the INSERT winner
 * creates a Mollie customer.
 */
export async function ensureActiveProviderCustomer(input: {
  applicationId?: string;
  configuredProviders?: BillingProviderConfigMap;
  connectionId?: string;
  idempotencyKey: string;
  now?: () => Date;
  principal: AthenaPrincipal;
  registry: BillingProviderRegistry;
  sql: BillingSqlExecutor;
  testMode?: boolean;
}): Promise<{ customerId: string; provider: BillingCustomer["provider"] }> {
  const subjectId = requireBillingPrincipalUserId(input.principal);
  const affinity = await resolveBillingConnectionAffinity({
    ownedConnectionId: input.connectionId,
    operation: "customers.create",
    provider: "mollie",
    sql: input.sql,
    subjectId,
    subjectKind: "user",
    testMode: input.testMode,
    ...(billingConfiguredConnectionOwner(input.applicationId) ?? {}),
  });
  const connectionId = affinity.connectionId;
  const configuredProviders = configuredProvidersForBillingConnection({
    affinity,
    configuredProviders: input.configuredProviders,
    operation: "customers.create",
  });
  const contact = await verifiedBillingContact({
    now: input.now,
    sql: input.sql,
    subjectId,
  });
  const createCustomer = () =>
    executeLocalBillingCustomerCreate({
      authority: PROCESS_BILLING_INVOCATION,
      configuredProviders,
      payload: {
        ...(contact ? { email: contact.email } : {}),
        idempotencyKey: `${input.idempotencyKey}:customer`,
        metadata: {
          athenaSubjectId: requireBillingPrincipalUserId(input.principal),
          athenaSubjectKind: "user",
        },
      },
      principal: selfDelegatedBillingPrincipal(input.principal, [
        "customers.create",
      ]),
      registry: input.registry,
      testMode: input.testMode,
    });
  const repository = createPostgresBillingSubjectRepository(input.sql);
  const subject = subjectFromPrincipalUser(
    requireBillingPrincipalUserId(input.principal)
  );
  for (let attempt = 0; attempt < 8; attempt++) {
    const bindings = await repository.listActiveBindings({
      connectionId,
      subject,
    });
    const usable = usableProviderCustomer(bindings);
    if (usable) {
      if (contact) {
        const recorded = await repository.recordContact({
          bindingId: usable.id,
          contact,
        });
        if (!recorded) {
          throw new Error("Failed to record verified Billing contact.");
        }
      }
      return {
        customerId: usable.providerSubjectId,
        provider: "mollie",
      };
    }
    const reserved = await repository.reserve({
      connectionId,
      providerSubjectKind: "customer",
      source: "created",
      subject,
      contact,
    });
    if (!reserved.inserted) {
      const existing =
        usableProviderCustomer([reserved.binding]) ??
        usableProviderCustomer(
          await repository.listActiveBindings({
            connectionId,
            subject,
          })
        );
      if (existing) {
        return {
          customerId: existing.providerSubjectId,
          provider: "mollie",
        };
      }
      continue;
    }
    const created = await createCustomer();
    try {
      await repository.activate({
        id: reserved.binding.id,
        providerSubjectId: created.providerCustomerId,
        reservationToken: reserved.binding.reservationToken,
      });
    } catch (error) {
      if (!isBillingUniqueViolation(error)) {
        throw error;
      }
      const after = usableProviderCustomer(
        await repository.listActiveBindings({
          connectionId,
          subject,
        })
      );
      if (after) {
        return {
          customerId: after.providerSubjectId,
          provider: "mollie",
        };
      }
      throw error;
    }
    return {
      customerId: created.providerCustomerId,
      provider: created.provider,
    };
  }
  throw new AthenaBillingCapabilityError({
    operation: "customers.create",
    reason: "runtime_unavailable",
  });
}
