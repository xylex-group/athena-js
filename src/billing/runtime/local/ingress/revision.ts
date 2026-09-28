import type { CanonicalBillingDocument } from "../../../canonical/document.ts";

export class AthenaBillingRevisionStaleError extends Error {
  readonly code = "ATHENA_BILLING_REVISION_STALE";

  constructor() {
    super("Canonical billing revision is stale relative to stored state.");
    this.name = "AthenaBillingRevisionStaleError";
  }
}

const STATUS_RANK: Record<string, number> = {
  active: 3,
  authorized: 2,
  canceled: 4,
  draft: 1,
  failed: 4,
  open: 2,
  paid: 4,
  past_due: 3,
  paused: 3,
  pending: 1,
  refunded: 5,
  trialing: 1,
  uncollectible: 4,
  void: 4,
};

function rank(document: CanonicalBillingDocument): number {
  return STATUS_RANK[document.status] ?? 0;
}

export function assertRevisionIsNotStale(
  previous: CanonicalBillingDocument | null,
  current: CanonicalBillingDocument
): void {
  if (previous == null || previous.kind !== current.kind) {
    return;
  }
  const previousTime = previous.updatedAt ?? previous.createdAt;
  const currentTime = current.updatedAt ?? current.createdAt;
  if (
    previousTime &&
    currentTime &&
    new Date(currentTime).getTime() < new Date(previousTime).getTime()
  ) {
    throw new AthenaBillingRevisionStaleError();
  }
  if (rank(current) < rank(previous)) {
    throw new AthenaBillingRevisionStaleError();
  }
}
