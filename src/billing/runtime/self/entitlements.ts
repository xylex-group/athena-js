import type { AthenaPrincipal } from "../../../runtime/data/principal.ts";
import { canonicalizeBillingSubscriptionStatus } from "../../canonical/status.ts";
import type { BillingSqlExecutor } from "../../subject/repository.ts";

export interface BillingEntitlementsSnapshot {
  readonly features: {
    readonly prioritySupport: boolean;
    readonly projects: number;
    readonly storageGb: number;
  };
  readonly plans: readonly string[];
  readonly subscription: {
    readonly canonicalStatus: string;
    readonly providerStatus: string;
    readonly renewsAt: string | null;
    readonly status: string;
  } | null;
}

const STARTER_FEATURES = {
  prioritySupport: false,
  projects: 10,
  storageGb: 50,
} as const;

const PRO_FEATURES = {
  prioritySupport: true,
  projects: 100,
  storageGb: 500,
} as const;

const EMPTY_FEATURES = {
  prioritySupport: false,
  projects: 0,
  storageGb: 0,
} as const;

const LIST_OWNED_SUBSCRIPTIONS_SQL = `
SELECT status, next_payment_date, metadata, description
FROM billing.billing_subscriptions
WHERE subject_kind = $1
  AND subject_id = $2
  AND ownership_status = 'resolved'
ORDER BY ingested_at DESC
LIMIT 8
`;

function featuresForPlan(
  plan: string
): BillingEntitlementsSnapshot["features"] {
  if (plan === "pro") {
    return { ...PRO_FEATURES };
  }
  if (plan === "starter") {
    return { ...STARTER_FEATURES };
  }
  return { ...EMPTY_FEATURES };
}

function planFromMetadata(
  metadata: unknown,
  description: unknown
): string | null {
  if (
    metadata !== null &&
    typeof metadata === "object" &&
    !Array.isArray(metadata)
  ) {
    const record = metadata as Record<string, unknown>;
    const productId = record.productId ?? record.plan;
    if (typeof productId === "string" && productId.trim()) {
      return productId.trim();
    }
    const priceId = record.priceId;
    if (priceId === "pro-monthly") {
      return "pro";
    }
    if (priceId === "starter-monthly") {
      return "starter";
    }
  }
  if (typeof description === "string") {
    const lowered = description.toLowerCase();
    if (lowered.includes("pro")) {
      return "pro";
    }
    if (lowered.includes("starter")) {
      return "starter";
    }
  }
  return null;
}

export function projectBillingEntitlementsFromCanonical(input: {
  description?: string | null;
  metadata?: unknown;
  nextPaymentDate?: string | null;
  providerStatus: string;
}): BillingEntitlementsSnapshot {
  const plan = planFromMetadata(input.metadata, input.description);
  const canonicalStatus = canonicalizeBillingSubscriptionStatus({
    providerStatus: input.providerStatus,
  });
  const active = canonicalStatus === "active" || canonicalStatus === "past_due";
  const plans = plan && active ? [plan] : [];
  return {
    features: plans[0] ? featuresForPlan(plans[0]) : { ...EMPTY_FEATURES },
    plans,
    subscription: {
      canonicalStatus,
      providerStatus: input.providerStatus,
      renewsAt: input.nextPaymentDate ?? null,
      status: canonicalStatus,
    },
  };
}

export async function getSelfEntitlements(input: {
  principal: AthenaPrincipal;
  sql: BillingSqlExecutor;
}): Promise<BillingEntitlementsSnapshot> {
  const result = await input.sql.query(LIST_OWNED_SUBSCRIPTIONS_SQL, [
    "user",
    input.principal.userId,
  ]);
  const row = result.rows[0];
  if (!row) {
    return {
      features: { ...EMPTY_FEATURES },
      plans: [],
      subscription: null,
    };
  }
  return projectBillingEntitlementsFromCanonical({
    description: typeof row.description === "string" ? row.description : null,
    metadata: row.metadata,
    nextPaymentDate:
      typeof row.next_payment_date === "string" ? row.next_payment_date : null,
    providerStatus: String(row.status ?? ""),
  });
}
