import type { AthenaAuthMutationScope } from "../hooks/scope.ts";
import type { AthenaAuthDatabase } from "../local/database.ts";
import type { AthenaAuthAuditEntry } from "./types.ts";

export interface AthenaAuthAuditWriter {
	write(
		scope: AthenaAuthMutationScope,
		entry: AthenaAuthAuditEntry,
	): Promise<void>;
}

export interface MemoryAuthAuditSink {
	entries: AthenaAuthAuditEntry[];
}

function jsonValue(value: unknown): unknown {
	return value === undefined ? null : value;
}

export function createMemoryAuthAuditWriter(
	sink: MemoryAuthAuditSink,
): AthenaAuthAuditWriter {
	return {
		async write(_scope, entry) {
			sink.entries.push({ ...entry });
		},
	};
}

export function createPostgresAuthAuditWriter(): AthenaAuthAuditWriter {
	return {
		async write(scope, entry) {
			if (!scope.persistAudit) {
				throw new Error(
					"ATHENA_AUTH_AUDIT_REQUIRES_TRANSACTION: audit_log_auth writes must use the mutation transaction",
				);
			}
			await scope.persistAudit(entry);
		},
	};
}

export async function insertAuditLogAuth(
	db: AthenaAuthDatabase,
	entry: AthenaAuthAuditEntry,
): Promise<void> {
	await db.query(
		`
INSERT INTO athena.audit_log_auth (
	id,
	event_id,
	trace_id,
	event,
	actor_kind,
	actor_user_id,
	actor_session_id,
	subject_type,
	subject_id,
	organization_id,
	previous,
	result,
	request_ip,
	request_user_agent,
	outcome,
	created_at
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW()
)
`,
		[
			entry.id,
			entry.eventId,
			entry.traceId,
			entry.event,
			entry.actor.kind,
			entry.actor.userId ?? null,
			entry.actor.sessionId ?? null,
			entry.subject?.type ?? null,
			entry.subject?.id ?? null,
			entry.organizationId ?? null,
			jsonValue(entry.previous),
			jsonValue(entry.result),
			entry.request.ipAddress ?? null,
			entry.request.userAgent ?? null,
			entry.outcome,
		],
	);
}
