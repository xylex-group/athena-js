import { toPublicApiKey } from "../local/api-key.ts";
import type {
	AuthAccountRow,
	AuthInvitationRow,
	AuthMemberRow,
	AuthOrganizationRow,
	AuthSessionRow,
	AuthUserRow,
} from "../local/models.ts";
import {
	toPublicInvitation,
	toPublicMember,
	toPublicOrganization,
	toPublicUser,
} from "../local/models.ts";
import type { AuthApiKeyRow } from "../local/stores.ts";

export type AthenaAuthHookUser = ReturnType<typeof toPublicUser>;

/** Sanitized account DTO for domain hooks. Never includes tokens or OAuth secrets. */
export type AthenaAuthHookAccount = {
	accountId: string;
	id: string;
	providerId: string;
	userId: string;
};

function firstString(
	row: Record<string, unknown>,
	keys: readonly string[],
): string {
	for (const key of keys) {
		const value = row[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return "";
}

export function sanitizeHookAccount(
	row: AuthAccountRow | Record<string, unknown>,
): AthenaAuthHookAccount {
	const record = row as Record<string, unknown>;
	return {
		accountId: firstString(record, ["accountId", "account_id"]),
		id: firstString(record, ["id"]),
		providerId: firstString(record, ["providerId", "provider_id"]),
		userId: firstString(record, ["userId", "user_id"]),
	};
}
export type AthenaAuthHookOrganization = ReturnType<
	typeof toPublicOrganization
>;
export type AthenaAuthHookMember = ReturnType<typeof toPublicMember>;
export type AthenaAuthHookInvitation = ReturnType<typeof toPublicInvitation>;

export function sanitizeHookUser(row: AuthUserRow): AthenaAuthHookUser {
	return toPublicUser(row);
}

export function sanitizeHookOrganization(
	row: AuthOrganizationRow,
): AthenaAuthHookOrganization {
	return toPublicOrganization(row);
}

export function sanitizeHookMember(row: AuthMemberRow): AthenaAuthHookMember {
	return toPublicMember(row);
}

export function sanitizeHookInvitation(
	row: AuthInvitationRow,
): AthenaAuthHookInvitation {
	return toPublicInvitation(row);
}

export function sanitizeHookSession(row: AuthSessionRow): {
	activeOrganizationId: string | null;
	expiresAt: string;
	id: string;
	impersonatedBy: string | null;
	userId: string;
} {
	const expiresAt =
		row.expires_at instanceof Date
			? row.expires_at.toISOString()
			: new Date(row.expires_at).toISOString();
	return {
		activeOrganizationId: row.active_organization_id,
		expiresAt,
		id: row.id,
		impersonatedBy: row.impersonated_by,
		userId: row.user_id,
	};
}

export function sanitizeHookApiKey(row: AuthApiKeyRow): {
	id: string;
	name: string | null;
	prefix: string | null;
	userId: string;
} {
	const publicKey = toPublicApiKey(row);
	return {
		id: row.id,
		name: typeof publicKey.name === "string" ? publicKey.name : row.name,
		prefix: row.prefix,
		userId: row.user_id,
	};
}

export type AthenaAuthHookPasskey = {
	createdAt?: string;
	id: string;
	name: string | null;
	userId: string;
};

export function sanitizeHookPasskey(input: {
	createdAt?: Date | string;
	id: string;
	name?: string | null;
	userId: string;
}): AthenaAuthHookPasskey {
	const createdAt =
		input.createdAt instanceof Date
			? input.createdAt.toISOString()
			: typeof input.createdAt === "string"
				? input.createdAt
				: undefined;
	return {
		createdAt,
		id: input.id,
		name: input.name ?? null,
		userId: input.userId,
	};
}
