import { ATHENA_AUTH_TABLES } from "../../auth/contract/index.ts";
import type { ResolvedBillingProviderConnection } from "../reconciliation/types.ts";
import { isBillingUniqueViolation } from "../subject/postgres.ts";
import type {
  BillingSqlExecutor,
  BillingSubjectBindingRecord,
} from "../subject/repository.ts";
import type { BillingSubjectRef } from "../types.ts";
import type {
  BillingImportBindingStore,
  BillingImportCursorStore,
  BillingImportDocumentStore,
} from "./apply.ts";
import { wrapBillingSqlExecutorAsDatabase } from "./database.ts";
import {
  ATHENA_BILLING_IMPORT_BINDING_CONFLICT,
  AthenaBillingImportError,
} from "./errors.ts";
import type {
  BillingImportDocumentHint,
  BillingSubjectDirectory,
  BillingSubjectRecord,
} from "./types.ts";

export {
  createBillingImportDatabaseFromManager,
  createBillingSqlExecutor,
  createBillingSqlExecutorFromManager,
} from "./database.ts";

const DOCUMENT_TABLES = [
  "billing.billing_payments",
  "billing.billing_subscriptions",
  "billing.billing_invoices",
] as const;

const CONNECTION_LIST_COLUMNS =
  "id::text AS id, provider, status, account_reference, environment, credential_reference, metadata";

function connectionEnvironment(value: unknown): "live" | "test" {
  return value === "test" ? "test" : "live";
}

function webhookIngressTokenFromMetadata(
  metadata: unknown
): string | undefined {
  if (
    metadata == null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    return;
  }
  const token = (metadata as { webhookIngressToken?: unknown })
    .webhookIngressToken;
  return typeof token === "string" && token.length > 0 ? token : undefined;
}

function asResolvedConnection(
  row: Record<string, unknown>
): ResolvedBillingProviderConnection {
  const environment = connectionEnvironment(row.environment);
  const provider = String(row.provider ?? "");
  const credentialReference =
    typeof row.credential_reference === "string" &&
    row.credential_reference.trim() !== ""
      ? row.credential_reference.trim()
      : `providers.${provider.toLowerCase() || "mollie"}`;
  const webhookIngressToken = webhookIngressTokenFromMetadata(row.metadata);
  return {
    accountReference: String(row.account_reference ?? ""),
    credentialReference,
    environment,
    id: String(row.id),
    provider,
    status: String(row.status ?? ""),
    testMode: environment === "test",
    ...(webhookIngressToken ? { webhookIngressToken } : {}),
  };
}

function asBinding(row: Record<string, unknown>): BillingSubjectBindingRecord {
  return {
    connectionId: String(row.connection_id),
    emailSnapshot:
      typeof row.email_snapshot === "string" ? row.email_snapshot : null,
    emailVerificationSource:
      row.email_verification_source === "athena-auth"
        ? "athena-auth"
        : null,
    verifiedEmailObservedAt:
      row.email_observed_at instanceof Date
        ? row.email_observed_at.toISOString()
        : typeof row.email_observed_at === "string"
          ? row.email_observed_at
          : null,
    id: String(row.id),
    isPrimary: row.is_primary === true,
    providerSubjectId: String(row.provider_subject_id),
    providerSubjectKind:
      row.provider_subject_kind === "recipient" ? "recipient" : "customer",
    source:
      row.source === "imported" || row.source === "reconciled"
        ? row.source
        : "created",
    status:
      row.status === "active" ||
      row.status === "conflict" ||
      row.status === "revoked"
        ? row.status
        : "pending",
    subjectId: String(row.subject_id),
    subjectKind: row.subject_kind === "organization" ? "organization" : "user",
  };
}

function ownershipStatus(
  value: unknown
): BillingImportDocumentHint["ownershipStatus"] {
  if (value === "resolved" || value === "conflict") {
    return value;
  }
  return "unresolved";
}

function hintFromRow(row: Record<string, unknown>): BillingImportDocumentHint {
  const subjectId =
    typeof row.subject_id === "string" && row.subject_id.length > 0
      ? row.subject_id
      : undefined;
  const subjectKind =
    row.subject_kind === "organization" || row.subject_kind === "user"
      ? row.subject_kind
      : undefined;
  return {
    connectionId: String(row.connection_id ?? ""),
    ownershipStatus: ownershipStatus(row.ownership_status),
    providerCustomerId: String(row.provider_customer_id ?? ""),
    subject:
      subjectId && subjectKind
        ? { id: subjectId, kind: subjectKind }
        : undefined,
  };
}

export type BillingImportConnectionRow = ResolvedBillingProviderConnection;

export async function listActiveBillingImportConnections(
  sql: BillingSqlExecutor,
  provider?: string
): Promise<readonly BillingImportConnectionRow[]> {
  const result =
    provider != null && provider.trim() !== ""
      ? await sql.query(
          `SELECT ${CONNECTION_LIST_COLUMNS}
					 FROM billing.billing_provider_connections
					 WHERE deleted_at IS NULL
					   AND status = 'active'
					   AND lower(provider) = lower($1)
					 ORDER BY created_at ASC`,
          [provider]
        )
      : await sql.query(
          `SELECT ${CONNECTION_LIST_COLUMNS}
					 FROM billing.billing_provider_connections
					 WHERE deleted_at IS NULL
					   AND status = 'active'
					 ORDER BY created_at ASC`
        );
  return result.rows.map((row) => asResolvedConnection(row));
}

export type BillingWebhookIngressBindingInspection =
  | { kind: "unknown" }
  | { kind: "resolved"; connectionId: string }
  | {
      kind: "environment_superseded";
      connectionEnvironment: "live" | "test";
      connectionId: string;
      processEnvironment: "live" | "test";
      status: string;
    };

export async function inspectBillingWebhookIngressBinding(
  sql: BillingSqlExecutor,
  input: { processEnvironment: "live" | "test"; token: string }
): Promise<BillingWebhookIngressBindingInspection> {
  const trimmed = input.token.trim();
  if (trimmed.length === 0) {
    return { kind: "unknown" };
  }
  const result = await sql.query(
    `SELECT id::text AS id, status, environment
		 FROM billing.billing_provider_connections
		 WHERE deleted_at IS NULL
		   AND metadata->>'webhookIngressToken' = $1
		 LIMIT 2`,
    [trimmed]
  );
  if (result.rows.length !== 1) {
    return { kind: "unknown" };
  }
  const row = result.rows[0];
  const id = row?.id;
  if (typeof id !== "string" || id.length === 0) {
    return { kind: "unknown" };
  }
  const status =
    typeof row?.status === "string" && row.status.length > 0
      ? row.status
      : "active";
  const boundEnvironment = connectionEnvironment(row?.environment);
  if (status === "active") {
    return { kind: "resolved", connectionId: id };
  }
  if (boundEnvironment !== input.processEnvironment) {
    return {
      kind: "environment_superseded",
      connectionEnvironment: boundEnvironment,
      connectionId: id,
      processEnvironment: input.processEnvironment,
      status,
    };
  }
  return { kind: "unknown" };
}

export async function resolveBillingConnectionIdByWebhookIngressToken(
  sql: BillingSqlExecutor,
  token: string
): Promise<string | undefined> {
  const inspected = await inspectBillingWebhookIngressBinding(sql, {
    processEnvironment: "test",
    token,
  });
  return inspected.kind === "resolved" ? inspected.connectionId : undefined;
}

export async function resolveBillingImportConnection(
  sql: BillingSqlExecutor,
  input: { connectionId?: string; provider?: string }
): Promise<BillingImportConnectionRow> {
  if (input.connectionId != null && input.connectionId.trim() !== "") {
    const result = await sql.query(
      `SELECT ${CONNECTION_LIST_COLUMNS}
			 FROM billing.billing_provider_connections
			 WHERE deleted_at IS NULL
			   AND (id::text = $1 OR account_reference = $1)
			   AND ($2::text IS NULL OR lower(provider) = lower($2))
			 LIMIT 2`,
      [input.connectionId, input.provider ?? null]
    );
    const row = result.rows[0];
    if (!row || result.rows.length !== 1) {
      throw new Error(
        result.rows.length > 1
          ? "Multiple billing connections matched --connection. Pass the connection UUID."
          : "No billing provider connection matched --connection."
      );
    }
    return asResolvedConnection(row);
  }
  const active = await listActiveBillingImportConnections(sql, input.provider);
  if (active.length === 1) {
    const only = active[0];
    if (only) {
      return only;
    }
  }
  if (active.length === 0) {
    throw new Error(
      "No active billing provider connections. Pass --connection <uuid>."
    );
  }
  throw new Error(
    "Multiple active billing connections. Pass --connection <uuid>."
  );
}

export function createPostgresBillingSubjectDirectory(
  sql: BillingSqlExecutor
): BillingSubjectDirectory {
  return {
    async findUsersByEmail(email: string) {
      const result = await sql.query(
        `SELECT id, email FROM ${ATHENA_AUTH_TABLES.users}
				 WHERE LOWER(btrim(email)) = LOWER(btrim($1))`,
        [email]
      );
      return result.rows.map((row) => ({
        email: typeof row.email === "string" ? row.email : null,
        subject: { id: String(row.id), kind: "user" as const },
      }));
    },
    async getById(subject: BillingSubjectRef) {
      if (subject.kind === "organization") {
        const result = await sql.query(
          `SELECT id FROM ${ATHENA_AUTH_TABLES.organization} WHERE id = $1`,
          [subject.id]
        );
        const row = result.rows[0];
        if (!row) {
          return null;
        }
        const record: BillingSubjectRecord = {
          email: null,
          subject,
        };
        return record;
      }
      const result = await sql.query(
        `SELECT id, email FROM ${ATHENA_AUTH_TABLES.users} WHERE id = $1`,
        [subject.id]
      );
      const row = result.rows[0];
      if (!row) {
        return null;
      }
      return {
        email: typeof row.email === "string" ? row.email : null,
        subject: { id: String(row.id), kind: "user" as const },
      };
    },
  };
}

async function findBindingByLocator(
  sql: BillingSqlExecutor,
  input: { connectionId: string; providerCustomerId: string }
): Promise<BillingSubjectBindingRecord | null> {
  const result = await sql.query(
    `SELECT * FROM billing.billing_subject_bindings
		 WHERE connection_id = $1::uuid
		   AND provider_subject_kind = 'customer'
		   AND provider_subject_id = $2
		 LIMIT 1`,
    [input.connectionId, input.providerCustomerId]
  );
  const row = result.rows[0];
  return row ? asBinding(row) : null;
}

export function createPostgresBillingImportBindingStore(
  sql: BillingSqlExecutor
): BillingImportBindingStore {
  return {
    async activate(input) {
      await sql.query(
        `UPDATE billing.billing_subject_bindings SET
					status = 'active',
					is_primary = true,
					source = $2,
					email_snapshot = COALESCE($3, email_snapshot),
					updated_at = now()
				 WHERE id = $1::uuid`,
        [input.id, input.source, input.emailSnapshot ?? null]
      );
    },
    async findActivePrimary(input) {
      const result = await sql.query(
        `SELECT * FROM billing.billing_subject_bindings
				 WHERE connection_id = $1::uuid
				   AND subject_kind = $2
				   AND subject_id = $3
				   AND provider_subject_kind = 'customer'
				   AND status = 'active'
				   AND is_primary = true
				 LIMIT 1`,
        [input.connectionId, input.subject.kind, input.subject.id]
      );
      const row = result.rows[0];
      return row ? asBinding(row) : null;
    },
    async findByLocator(input) {
      return findBindingByLocator(sql, input);
    },
    async insertActive(input) {
      try {
        const result = await sql.query(
          `INSERT INTO billing.billing_subject_bindings (
						connection_id,
						subject_kind,
						subject_id,
						provider_subject_kind,
						provider_subject_id,
						status,
						source,
						is_primary,
						email_snapshot
					) VALUES (
						$1::uuid, $2, $3, 'customer', $4, 'active', $5, true, $6
					)
					RETURNING *`,
          [
            input.connectionId,
            input.subject.kind,
            input.subject.id,
            input.providerCustomerId,
            input.source,
            input.emailSnapshot ?? null,
          ]
        );
        const row = result.rows[0];
        if (!row) {
          throw new Error("Failed to insert billing subject binding.");
        }
        return asBinding(row);
      } catch (error) {
        if (!isBillingUniqueViolation(error)) {
          throw error;
        }
        const existing = await findBindingByLocator(sql, {
          connectionId: input.connectionId,
          providerCustomerId: input.providerCustomerId,
        });
        if (
          existing &&
          existing.subjectId === input.subject.id &&
          existing.subjectKind === input.subject.kind
        ) {
          return existing;
        }
        throw new AthenaBillingImportError({
          code: ATHENA_BILLING_IMPORT_BINDING_CONFLICT,
          message:
            "Provider customer locator already bound to a different Athena subject.",
        });
      }
    },
    async recordConflict(input) {
      await sql.query(
        `INSERT INTO billing.billing_binding_conflicts (
					subject_kind, subject_id, connection_id, candidate_provider_customer_id,
					reason, confidence, status, last_observed_at, observation_count
				) VALUES ($1, $2, $3::uuid, $4, $5, $6, 'open', now(), 1)
				ON CONFLICT (
					connection_id,
					candidate_provider_customer_id,
					identity_subject_kind,
					identity_subject_id
				)
				WHERE status = 'open'
				DO UPDATE SET
					reason = EXCLUDED.reason,
					confidence = EXCLUDED.confidence,
					last_observed_at = now(),
					observation_count = billing.billing_binding_conflicts.observation_count + 1`,
        [
          input.subject?.kind ?? null,
          input.subject?.id ?? null,
          input.connectionId,
          input.providerCustomerId,
          input.reason,
          input.confidence,
        ]
      );
    },
  };
}

export function createPostgresBillingImportCursorStore(
  sql: BillingSqlExecutor
): BillingImportCursorStore {
  return {
    async get(connectionId) {
      const result = await sql.query(
        `SELECT cursor FROM billing.billing_import_state
				 WHERE connection_id = $1::uuid AND resource_kind = 'customers'`,
        [connectionId]
      );
      const cursor = result.rows[0]?.cursor;
      return typeof cursor === "string" && cursor.length > 0 ? cursor : null;
    },
    async set(connectionId, cursor) {
      await sql.query(
        `INSERT INTO billing.billing_import_state (
					connection_id, resource_kind, cursor, last_completed_at
				) VALUES ($1::uuid, 'customers', $2, now())
				ON CONFLICT (connection_id, resource_kind) DO UPDATE SET
					cursor = EXCLUDED.cursor,
					last_completed_at = now()`,
        [connectionId, cursor]
      );
    },
  };
}

export function createPostgresBillingImportDocumentStore(
  sql: BillingSqlExecutor
): BillingImportDocumentStore {
  return {
    async hintsForCustomer(input) {
      const hints: BillingImportDocumentHint[] = [];
      for (const table of DOCUMENT_TABLES) {
        const result = await sql.query(
          `SELECT connection_id::text AS connection_id,
					        ownership_status,
					        provider_customer_id,
					        subject_kind,
					        subject_id
					 FROM ${table}
					 WHERE provider_customer_id = $2
					   AND (connection_id = $1::uuid OR connection_id IS NULL)`,
          [input.connectionId, input.providerCustomerId]
        );
        for (const row of result.rows) {
          hints.push(hintFromRow(row));
        }
      }
      return hints;
    },
    async projectForBinding(input) {
      const params = [
        input.providerCustomerId,
        input.connectionId,
        input.subject.kind,
        input.subject.id,
      ];
      const db = wrapBillingSqlExecutorAsDatabase(sql);
      return db.transaction(async (tx) => {
        let conflicts = 0;
        let resolved = 0;
        for (const table of DOCUMENT_TABLES) {
          const projected = await tx.query(
            `UPDATE ${table} SET
							connection_id = CASE
								WHEN ownership_status = 'resolved'
								  AND subject_id IS NOT NULL
								  AND (subject_kind <> $3 OR subject_id <> $4)
								THEN connection_id
								WHEN ownership_status <> 'conflict'
								  AND (
									ownership_status = 'unresolved'
									OR subject_id IS NULL
									OR (subject_kind = $3 AND subject_id = $4)
								  )
								THEN $2::uuid
								ELSE connection_id
							END,
							subject_kind = CASE
								WHEN ownership_status = 'resolved'
								  AND subject_id IS NOT NULL
								  AND (subject_kind <> $3 OR subject_id <> $4)
								THEN subject_kind
								WHEN ownership_status <> 'conflict'
								  AND (
									ownership_status = 'unresolved'
									OR subject_id IS NULL
									OR (subject_kind = $3 AND subject_id = $4)
								  )
								THEN $3
								ELSE subject_kind
							END,
							subject_id = CASE
								WHEN ownership_status = 'resolved'
								  AND subject_id IS NOT NULL
								  AND (subject_kind <> $3 OR subject_id <> $4)
								THEN subject_id
								WHEN ownership_status <> 'conflict'
								  AND (
									ownership_status = 'unresolved'
									OR subject_id IS NULL
									OR (subject_kind = $3 AND subject_id = $4)
								  )
								THEN $4
								ELSE subject_id
							END,
							ownership_status = CASE
								WHEN ownership_status = 'resolved'
								  AND subject_id IS NOT NULL
								  AND (subject_kind <> $3 OR subject_id <> $4)
								THEN 'conflict'
								WHEN ownership_status <> 'conflict'
								  AND (
									ownership_status = 'unresolved'
									OR subject_id IS NULL
									OR (subject_kind = $3 AND subject_id = $4)
								  )
								THEN 'resolved'
								ELSE ownership_status
							END
						 WHERE provider_customer_id = $1
						   AND (connection_id = $2::uuid OR connection_id IS NULL)
						   AND (
							 (
							   ownership_status = 'resolved'
							   AND subject_id IS NOT NULL
							   AND (subject_kind <> $3 OR subject_id <> $4)
							 )
							 OR (
							   ownership_status <> 'conflict'
							   AND (
								 ownership_status = 'unresolved'
								 OR subject_id IS NULL
								 OR (subject_kind = $3 AND subject_id = $4)
							   )
							 )
						   )
						 RETURNING ownership_status`,
            params
          );
          for (const row of projected.rows) {
            if (row.ownership_status === "conflict") {
              conflicts += 1;
            } else if (row.ownership_status === "resolved") {
              resolved += 1;
            }
          }
        }
        return { conflicts, resolved };
      });
    },
  };
}
