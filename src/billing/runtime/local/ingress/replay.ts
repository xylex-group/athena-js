import {
  ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID,
  isAthenaEventIngressError,
} from "../../../../runtime/ingress/errors.ts";
import {
  classifyIngressFailure,
  INGRESS_MAX_ATTEMPTS,
  INGRESS_PROCESSING_LEASE_MS,
  type IngressFailureStage,
} from "../../../../runtime/ingress/failure.ts";
import {
  ATHENA_INGRESS_OPERATION_HEADER,
  type AthenaIngressIR,
} from "../../../../runtime/ingress/ir.ts";
import { memoryIngressFromRecord } from "../../../../runtime/ingress/memory.ts";
import type {
  EventIngressDatabase,
  EventIngressPersistence,
  EventIngressRecord,
} from "../../../../runtime/ingress/persistence.ts";
import type { EventIngressRuntime } from "../../../../runtime/ingress/runtime.ts";
import {
  type EventIngressRow,
  mapIngressRow,
} from "../../../../runtime/ingress/sql.ts";
import { mollieWebhookChannel } from "../providers/mollie/channel.ts";
import { parseMollieWebhookForChannel } from "../providers/mollie/parse-webhook.ts";

export const BILLING_INGRESS_REPLAY_BATCH_DEFAULT = 25;

export interface BillingIngressReplayResult {
  classified: number;
  failed: number;
  processed: number;
  replayed: number;
  retryable: number;
  skipped: number;
  terminal: number;
}

export function persistedIngressOperation(
  record: EventIngressRecord
): string | undefined {
  const column = record.operation?.trim();
  if (column) {
    return column;
  }
  const header = record.headers[ATHENA_INGRESS_OPERATION_HEADER]?.trim();
  if (header) {
    return header;
  }
}

function classifyStuckResolving(record: EventIngressRecord): {
  stage: IngressFailureStage;
  error: unknown;
} {
  const operation = persistedIngressOperation(record);
  const channel = operation ? mollieWebhookChannel(operation) : undefined;
  if (channel == null) {
    return {
      error: new Error(
        "Ingress replay requires the persisted channel operation; do not infer it from the body."
      ),
      stage: "parse",
    };
  }
  try {
    parseMollieWebhookForChannel(
      channel.kind,
      record.body,
      record.headers["content-type"]
    );
    return {
      error: new Error(
        "Ingress remained resolving after the processing lease expired."
      ),
      stage: "refetch",
    };
  } catch (error) {
    if (
      isAthenaEventIngressError(error) &&
      error.code === ATHENA_INGRESS_MOLLIE_ENVELOPE_INVALID
    ) {
      return { error, stage: "parse" };
    }
    return { error, stage: "parse" };
  }
}

export async function classifyStuckBillingIngress(input: {
  database: EventIngressDatabase;
  dryRun?: boolean;
  limit?: number;
  persistence: EventIngressPersistence;
}): Promise<{ classified: number; terminal: number; retryable: number }> {
  const limit = input.limit ?? BILLING_INGRESS_REPLAY_BATCH_DEFAULT;
  const listed = await input.database.query<{ id: string }>(
    `
SELECT id
FROM athena.event_ingress
WHERE domain = 'billing'
  AND status = 'resolving'
  AND (
    lease_expires_at IS NULL
    OR lease_expires_at < now()
    OR received_at < now() - interval '5 minutes'
  )
ORDER BY received_at
LIMIT $1
`,
    [limit]
  );
  if (input.dryRun) {
    return { classified: listed.rows.length, retryable: 0, terminal: 0 };
  }
  let classified = 0;
  let terminal = 0;
  let retryable = 0;
  for (const row of listed.rows) {
    await input.database.transaction(async (tx) => {
      const locked = await input.persistence.lock(tx, row.id);
      if (locked?.status !== "resolving") {
        return;
      }
      if (locked.attemptCount >= INGRESS_MAX_ATTEMPTS) {
        const classifiedFailure = classifyIngressFailure({
          attemptCount: locked.attemptCount + 1,
          error: new Error("Ingress retry budget exhausted."),
          firstFailedAt: locked.firstFailedAt ?? undefined,
          stage: "unknown",
        });
        await input.persistence.markStatus(tx, {
          error: classifiedFailure.error,
          failureStage: classifiedFailure.stage,
          firstFailedAt: new Date(classifiedFailure.error.firstFailedAt),
          ingressId: locked.id,
          lastFailedAt: new Date(),
          status: "terminal_failure",
        });
        terminal += 1;
        classified += 1;
        return;
      }
      const stuck = classifyStuckResolving(locked);
      const classifiedFailure = classifyIngressFailure({
        attemptCount: locked.attemptCount + 1,
        error: stuck.error,
        firstFailedAt: locked.firstFailedAt ?? undefined,
        stage: stuck.stage,
      });
      await input.persistence.markStatus(tx, {
        error: classifiedFailure.error,
        failureStage: classifiedFailure.stage,
        firstFailedAt: new Date(classifiedFailure.error.firstFailedAt),
        ingressId: locked.id,
        lastFailedAt: new Date(),
        status: classifiedFailure.status,
        ...(classifiedFailure.nextAttemptAt
          ? { nextAttemptAt: classifiedFailure.nextAttemptAt }
          : {}),
      });
      classified += 1;
      if (classifiedFailure.status === "terminal_failure") {
        terminal += 1;
      } else {
        retryable += 1;
      }
    });
  }
  return { classified, retryable, terminal };
}

export async function replayBillingIngressBatch(input: {
  database: EventIngressDatabase;
  limit?: number;
  ownerId?: string;
  persistence: EventIngressPersistence;
  runtime: EventIngressRuntime;
}): Promise<BillingIngressReplayResult> {
  const limit = input.limit ?? BILLING_INGRESS_REPLAY_BATCH_DEFAULT;
  const ownerId = input.ownerId ?? crypto.randomUUID();
  const claimed = await input.database.transaction(async (tx) =>
    tx.query<EventIngressRow>(
      `
WITH next_rows AS (
  SELECT id
  FROM athena.event_ingress
  WHERE domain = 'billing'
    AND attempt_count < $2
    AND (
      (
        status = 'retryable_failure'
        AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      )
      OR (
        status = 'resolving'
        AND (lease_expires_at IS NULL OR lease_expires_at < now())
      )
    )
  ORDER BY received_at
  FOR UPDATE SKIP LOCKED
  LIMIT $1
)
UPDATE athena.event_ingress AS target
SET
  status = 'resolving',
  lease_owner = $3,
  lease_expires_at = now() + ($4::int * interval '1 millisecond')
FROM next_rows
WHERE target.id = next_rows.id
RETURNING target.*
`,
      [limit, INGRESS_MAX_ATTEMPTS, ownerId, INGRESS_PROCESSING_LEASE_MS]
    )
  );
  const result: BillingIngressReplayResult = {
    classified: 0,
    failed: 0,
    processed: 0,
    replayed: claimed.rows.length,
    retryable: 0,
    skipped: 0,
    terminal: 0,
  };
  for (const row of claimed.rows) {
    const record = mapIngressRow(row);
    let ingress: AthenaIngressIR;
    try {
      ingress = memoryIngressFromRecord(record);
    } catch {
      result.failed += 1;
      continue;
    }
    try {
      const ingest = await input.runtime.ingest(ingress);
      if (ingest.duplicate) {
        result.skipped += 1;
      } else {
        result.processed += 1;
      }
    } catch {
      result.failed += 1;
    }
  }
  return result;
}
