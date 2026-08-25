import type { EmitAuthEmailInput } from "../../email/emit.ts";
import type { AuthDomainMutate } from "../../hooks/execute.ts";
import { sanitizeHookUser } from "../../hooks/sanitize.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import type { AuthUserRow } from "../models.ts";
import { toPublicUser } from "../models.ts";
import type { AthenaAuthEmailStore } from "./store.ts";

const CHANGE_EMAIL_IDENTIFIER = /^change-email:([^:]+):(.+)$/;

export function parseChangeEmailIdentifier(
	identifier: string,
): { email: string; userId: string } | undefined {
	const match = CHANGE_EMAIL_IDENTIFIER.exec(identifier);
	const userId = match?.[1];
	const email = match?.[2];
	if (!(userId && email)) {
		return;
	}
	return { email, userId };
}

export async function resolveChangeEmailTarget(
	stores: AthenaAuthStores,
	token: string,
): Promise<{ email: string; userId: string }> {
	const pending = await stores.getVerificationByValue(token);
	const parsed = pending
		? parseChangeEmailIdentifier(pending.identifier)
		: undefined;
	if (!parsed) {
		throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
	}
	return parsed;
}

export async function applyChangeEmailToken(
	stores: AthenaAuthStores,
	token: string,
): Promise<AuthUserRow> {
	const verification = await stores.consumeVerification(token);
	if (!verification) {
		throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
	}
	const parsed = parseChangeEmailIdentifier(verification.identifier);
	if (!parsed) {
		throw AthenaAuthRuntimeError.badRequest("Invalid token");
	}
	return stores.updateUser(parsed.userId, {
		email: parsed.email,
		emailVerified: true,
	});
}

export async function applyDeleteUserToken(
	stores: AthenaAuthStores,
	token: string,
): Promise<string> {
	const verification = await stores.consumeVerification(token);
	if (!verification) {
		throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
	}
	const userId = parseDeleteUserIdentifier(verification.identifier);
	if (!userId) {
		throw AthenaAuthRuntimeError.badRequest("Invalid token");
	}
	await stores.deleteUser(userId);
	return userId;
}

export function parseDeleteUserIdentifier(
	identifier: string,
): string | undefined {
	const userId = identifier.replace(/^delete_user:/, "");
	if (!userId || identifier === userId) {
		return;
	}
	return userId;
}

export async function resolveDeleteUserTarget(
	stores: AthenaAuthStores,
	token: string,
): Promise<string> {
	const pending = await stores.getVerificationByValue(token);
	const userId = pending
		? parseDeleteUserIdentifier(pending.identifier)
		: undefined;
	if (!userId) {
		throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
	}
	return userId;
}

export async function handleUserMailRoutes(
	request: Request,
	path: string,
	method: string,
	ctx: {
		emailStore: AthenaAuthEmailStore;
		headers: Headers;
		hookRequest: (
			request: Request,
			path: string,
		) => {
			ipAddress?: string;
			method: string;
			path: string;
			userAgent?: string;
		};
		mutate: AuthDomainMutate;
		requireSession: (
			request: Request,
			stores: AthenaAuthStores,
		) => Promise<{ user: AuthUserRow }>;
		stores: AthenaAuthStores;
		traceId: string;
	},
): Promise<Response | null> {
	if (path === "/email/list" && method === "GET") {
		const { user } = await ctx.requireSession(request, ctx.stores);
		const recipient = (user.email ?? "").trim().toLowerCase();
		const rows = (await ctx.emailStore.listEmails()).filter(
			(row) => row.recipient_email.trim().toLowerCase() === recipient,
		);
		return jsonResponse(
			200,
			{
				emails: rows,
				limit: rows.length,
				offset: 0,
				total: rows.length,
			},
			ctx.headers,
		);
	}

	if (path === "/change-email/verify" && method === "GET") {
		const token = new URL(request.url).searchParams.get("token")?.trim();
		if (!token) {
			throw AthenaAuthRuntimeError.badRequest("token is required");
		}
		const target = await resolveChangeEmailTarget(ctx.stores, token);
		const previousUser = await ctx.stores.getUserById(target.userId);
		const updated = await ctx.mutate({
			context: {
				actor: { kind: "user", userId: target.userId },
				request: ctx.hookRequest(request, path),
				traceId: ctx.traceId,
			},
			event: "user.email.update",
			execute: (scope) => applyChangeEmailToken(scope.stores, token),
			input: { email: target.email, userId: target.userId },
			previous: async () => {
				if (!previousUser) {
					throw AthenaAuthRuntimeError.notFound("User not found");
				}
				return { email: previousUser.email };
			},
			resultOf: (row) => ({ user: sanitizeHookUser(row) }),
		});
		return jsonResponse(
			200,
			{ status: true, user: toPublicUser(updated) },
			ctx.headers,
		);
	}

	if (path === "/delete-user/verify" && method === "GET") {
		const token = new URL(request.url).searchParams.get("token")?.trim();
		if (!token) {
			throw AthenaAuthRuntimeError.badRequest("token is required");
		}
		const userId = await resolveDeleteUserTarget(ctx.stores, token);
		const previousUser = await ctx.stores.getUserById(userId);
		if (!previousUser) {
			throw AthenaAuthRuntimeError.notFound("User not found");
		}
		await ctx.mutate({
			context: {
				actor: { kind: "user", userId },
				request: ctx.hookRequest(request, path),
				traceId: ctx.traceId,
			},
			event: "user.delete",
			execute: (scope) => applyDeleteUserToken(scope.stores, token),
			input: { userId },
			previous: async () => ({ user: sanitizeHookUser(previousUser) }),
			resultOf: () => ({
				deleted: true as const,
				id: userId,
				userId,
			}),
		});
		return jsonResponse(200, { status: true, success: true }, ctx.headers);
	}

	if (
		method === "GET" &&
		(path === "/reset-password/{token}" || path.startsWith("/reset-password/"))
	) {
		const token = decodeURIComponent(path.slice("/reset-password/".length));
		if (!token) {
			throw AthenaAuthRuntimeError.badRequest("token is required");
		}
		const verification = await ctx.stores.getVerificationByValue(token);
		if (!verification) {
			throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
		}
		const origin = new URL(request.url).origin;
		const location = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
		const headers = new Headers(ctx.headers);
		headers.set("location", location);
		return new Response(null, {
			headers,
			status: 302,
		});
	}

	return null;
}

export function tokenizedUrl(
	base: string | undefined,
	token: string,
	origin: string,
	fallbackPath: string,
): string {
	if (base?.trim()) {
		const trimmed = base.trim();
		const joiner = trimmed.includes("?") ? "&" : "?";
		return `${trimmed}${joiner}token=${encodeURIComponent(token)}`;
	}
	return `${origin}${fallbackPath}?token=${encodeURIComponent(token)}`;
}

export type MailerEmit = (
	input: EmitAuthEmailInput,
) => Promise<{ success: boolean }>;
