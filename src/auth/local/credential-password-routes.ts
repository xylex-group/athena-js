import { authEmailEvents } from "../email/index.ts";
import { tokenizedUrl } from "./email/user-routes.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "./errors.ts";
import type { AthenaAuthStores } from "./memory-stores.ts";
import {
	validatePassword,
	withPasswordHash,
} from "./password.ts";
import { asStringField, readJsonBody, requireStringField } from "./security.ts";
import type { AuthRuntimeDependencies } from "./runtime-dependencies.ts";

export interface AuthProcedureContext {
	deps: AuthRuntimeDependencies;
	headers: Headers;
	stores: AthenaAuthStores;
	traceId: string;
}

export async function handleCredentialPasswordRoutes(
	request: Request,
	path: string,
	method: string,
	ctx: AuthProcedureContext,
): Promise<Response | undefined> {
	const { config, emitIfRecipient, emitMail, hasher, hookRequest, mutate } =
		ctx.deps;
	const issueSession = ctx.deps.issueSession;
	const currentStores = ctx.stores;
	const headers = ctx.headers;
	const traceId = ctx.traceId;
	if (method !== "POST") {
		return undefined;
	}
	if (typeof issueSession !== "function") {
		throw AthenaAuthRuntimeError.internal(
			new Error("canonical issueSession is required"),
		);
	}
	if (path === "/forget-password" && method === "POST") {
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const email = requireStringField(body, "email");
			const user = await currentStores.getUserByEmail(email);
			if (user) {
				const token = Buffer.from(
					crypto.getRandomValues(new Uint8Array(32)),
				).toString("base64url");
				await currentStores.createVerification({
					expiresAt: new Date(Date.now() + 60 * 60 * 1000),
					id: crypto.randomUUID(),
					identifier: `reset:${user.email ?? email}`,
					value: token,
				});
				const origin = new URL(request.url).origin;
				const redirectTo = asStringField(body, "redirectTo");
				const resetUrl = tokenizedUrl(
					redirectTo,
					token,
					origin,
					"/reset-password",
				);
				await emitMail({
					data: {
						legacy_hook_url: redirectTo ? resetUrl : token,
						reset_url: resetUrl,
					},
					eventType: authEmailEvents.user.password.reset,
					recipient: email,
				});
			}
			return jsonResponse(200, { status: true }, headers);
		}

if (path === "/reset-password" && method === "POST") {
			const body = await readJsonBody(request, config.security.bodyLimitBytes);
			const token = requireStringField(body, "token");
			const newPassword =
				asStringField(body, "newPassword") ??
				requireStringField(body, "password");
			validatePassword(newPassword, {
				maxLength: config.emailAndPassword.maxPasswordLength,
				minLength: config.emailAndPassword.minPasswordLength,
			});
			const verification = await currentStores.getVerificationByValue(token);
			if (!verification) {
				throw AthenaAuthRuntimeError.badRequest("Invalid or expired token");
			}
			const email = verification.identifier.replace(/^reset:/, "");
			const user = await currentStores.getUserByEmail(email);
			if (!user) {
				throw AthenaAuthRuntimeError.notFound("User not found");
			}
			const hash = await hasher.hash(newPassword);
			await mutate({
				context: {
					actor: { kind: "user", userId: user.id },
					request: hookRequest(request, path),
					traceId,
				},
				event: "user.password.reset",
				execute: async (scope) => {
					const consumed = await scope.stores.consumeVerification(token);
					if (!consumed) {
						throw AthenaAuthRuntimeError.badRequest(
							"Invalid or expired token",
						);
					}
					await scope.stores.updateUser(user.id, {
						metadata: withPasswordHash(
							typeof user.metadata === "object" ? user.metadata : {},
							hash,
						),
					});
					await scope.stores.deleteUserSessions(user.id);
				},
				input: { userId: user.id },
				resultOf: () => ({ userId: user.id }),
			});
			await emitIfRecipient(user.email, {
				data: {},
				eventType: authEmailEvents.user.password.changed,
			});
			return jsonResponse(200, { status: true }, headers);
		}

	return undefined;
}
