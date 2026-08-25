import { AthenaAuthRuntimeError } from "../local/errors.ts";
import type { AthenaAuthAuditEntry } from "./types.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	return value as Record<string, unknown>;
}

function isPresentSnapshot(value: unknown): boolean {
	if (value === undefined || value === null) {
		return false;
	}
	const record = asRecord(value);
	if (record && Object.keys(record).length === 0) {
		return false;
	}
	return true;
}

function isTombstoneReceipt(value: unknown): boolean {
	const record = asRecord(value);
	return (
		record !== null &&
		record.deleted === true &&
		typeof record.id === "string" &&
		record.id.length > 0
	);
}

function isSessionRevokeReceipt(value: unknown): boolean {
	const record = asRecord(value);
	return (
		record !== null &&
		record.revoked === true &&
		typeof record.id === "string" &&
		record.id.length > 0 &&
		typeof record.userId === "string" &&
		record.userId.length > 0
	);
}

function auditError(code: string): AthenaAuthRuntimeError {
	return new AthenaAuthRuntimeError(500, code, {
		code,
		internalMessage: code,
	});
}

export function validateAuthAuditEntry(
	entry: AthenaAuthAuditEntry,
	ir: {
		mutationKind: string;
		previous: string;
		resolveOrganizationId?: unknown;
		result: string;
		subjectType?: string;
	},
): void {
	if (!isPresentSnapshot(entry.result)) {
		throw auditError("ATHENA_AUTH_AUDIT_RESULT_REQUIRED");
	}
	if (ir.mutationKind === "delete" && !isTombstoneReceipt(entry.result)) {
		throw auditError("ATHENA_AUTH_AUDIT_INVALID_RESULT");
	}
	if (
		(entry.event === "session.revoke" ||
			entry.event === "session.impersonation.end") &&
		!isSessionRevokeReceipt(entry.result)
	) {
		throw auditError("ATHENA_AUTH_AUDIT_INVALID_RESULT");
	}
	if (ir.result === "resource" && asRecord(entry.result) === null) {
		throw auditError("ATHENA_AUTH_AUDIT_INVALID_RESULT");
	}
	if (ir.previous === "required" && !isPresentSnapshot(entry.previous)) {
		throw auditError("ATHENA_AUTH_AUDIT_PREVIOUS_REQUIRED");
	}
	if (
		typeof entry.subject?.id !== "string" ||
		entry.subject.id.length === 0 ||
		typeof entry.subject.type !== "string" ||
		entry.subject.type.length === 0
	) {
		throw auditError("ATHENA_AUTH_AUDIT_SUBJECT_REQUIRED");
	}
	if (entry.subject.type !== ir.subjectType) {
		throw auditError("ATHENA_AUTH_AUDIT_SUBJECT_TYPE_MISMATCH");
	}
	if (
		typeof ir.resolveOrganizationId === "function" &&
		(typeof entry.organizationId !== "string" ||
			entry.organizationId.length === 0)
	) {
		throw auditError("ATHENA_AUTH_AUDIT_ORGANIZATION_UNRESOLVED");
	}
}
