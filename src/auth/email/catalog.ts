import type { AthenaAuthEmailStore } from "../local/email/store.ts";
import { builtinTemplateRow } from "./builtins.ts";
import type { AthenaAuthEmailTemplateRow } from "./contract.ts";
import { getAuthEmailEventDefinition } from "./events.ts";

export interface AuthEmailUserView {
	email?: string;
	id?: string;
	name?: string;
}

export interface AuthEmailApplicationView {
	name?: string;
	url?: string;
}

/** View for `user.password.reset` / `password_reset_email`. Wire: `reset_url`. */
export interface PasswordResetTemplateData {
	application?: AuthEmailApplicationView;
	expiresAt?: string;
	resetUrl: string;
	user?: AuthEmailUserView;
}

/** View for `user.email.verify` / `verification_email`. Wire: `verification_url`. */
export interface VerifyEmailTemplateData {
	application?: AuthEmailApplicationView;
	expiresAt?: string;
	user?: AuthEmailUserView;
	verificationUrl: string;
}

/** View for `user.email.change.confirmation`. Wire: `verification_url`. */
export interface ChangeEmailTemplateData {
	application?: AuthEmailApplicationView;
	expiresAt?: string;
	user?: AuthEmailUserView;
	verificationUrl: string;
}

/** View for `user.account.delete.confirmation`. Wire: `verification_url`. */
export interface DeleteUserConfirmationTemplateData {
	application?: AuthEmailApplicationView;
	expiresAt?: string;
	user?: AuthEmailUserView;
	verificationUrl: string;
}

/** View for `organization.member.invite`. */
export interface OrganizationInvitationTemplateData {
	application?: AuthEmailApplicationView;
	invitationUrl: string;
	inviterIdentity: string;
	organizationName: string;
	role: string;
	user?: AuthEmailUserView;
}

/** View for `user.sign-in.otp` / `two_factor_otp_email`. Wire: `otp_code`. */
export interface OtpTemplateData {
	application?: AuthEmailApplicationView;
	otpCode: string;
	user?: AuthEmailUserView;
}

export type AuthEmailTemplateView =
	| ChangeEmailTemplateData
	| DeleteUserConfirmationTemplateData
	| OrganizationInvitationTemplateData
	| OtpTemplateData
	| PasswordResetTemplateData
	| Record<string, unknown>
	| VerifyEmailTemplateData;

function asString(value: unknown): string | undefined {
	if (typeof value === "string") {
		return value;
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return undefined;
}

function toSnakeCase(key: string): string {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.replace(/-/g, "_")
		.toLowerCase();
}

function assignIfPresent(
	out: Record<string, string>,
	key: string,
	value: unknown,
): void {
	const text = asString(value);
	if (text !== undefined) {
		out[key] = text;
	}
}

function flattenRecord(view: Record<string, unknown>): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(view)) {
		if (key === "user" || key === "application") {
			continue;
		}
		if (value && typeof value === "object" && !Array.isArray(value)) {
			continue;
		}
		assignIfPresent(out, toSnakeCase(key), value);
	}

	const user = view.user;
	if (user && typeof user === "object" && !Array.isArray(user)) {
		const fields = user as Record<string, unknown>;
		assignIfPresent(out, "user_id", fields.id);
		assignIfPresent(out, "user_email", fields.email);
		assignIfPresent(out, "user_name", fields.name);
	}

	const application = view.application;
	if (
		application &&
		typeof application === "object" &&
		!Array.isArray(application)
	) {
		const fields = application as Record<string, unknown>;
		assignIfPresent(out, "app_name", fields.name);
		assignIfPresent(out, "application_url", fields.url);
	}

	assignIfPresent(out, "reset_url", view.resetUrl);
	assignIfPresent(out, "verification_url", view.verificationUrl);
	assignIfPresent(out, "otp_code", view.otpCode);
	assignIfPresent(out, "invitation_url", view.invitationUrl);
	assignIfPresent(out, "inviter_identity", view.inviterIdentity);
	assignIfPresent(out, "organization_name", view.organizationName);
	assignIfPresent(out, "expires_at", view.expiresAt);
	assignIfPresent(out, "sign_in_url", view.signInUrl);
	assignIfPresent(out, "dashboard_url", view.dashboardUrl);
	assignIfPresent(out, "support_url", view.supportUrl);
	assignIfPresent(out, "alert_title", view.alertTitle);
	assignIfPresent(out, "alert_details", view.alertDetails);
	assignIfPresent(out, "organization_url", view.organizationUrl);
	assignIfPresent(out, "member_identity", view.memberIdentity);
	assignIfPresent(out, "actor_identity", view.actorIdentity);
	assignIfPresent(out, "new_role", view.newRole);
	assignIfPresent(out, "previous_role", view.previousRole);
	assignIfPresent(out, "invited_email", view.invitedEmail);
	return out;
}

export function flattenAuthEmailTemplateData(
	_eventType: string,
	view: AuthEmailTemplateView,
): Record<string, string> {
	return flattenRecord(view as Record<string, unknown>);
}

export function assertAuthEmailRequiredVariables(
	eventType: string,
	data: Record<string, string>,
): void {
	const definition = getAuthEmailEventDefinition(eventType);
	if (!definition) {
		return;
	}
	const missing = definition.required_variables.filter((key) => {
		const value = data[key];
		return typeof value !== "string" || value.trim().length === 0;
	});
	if (missing.length > 0) {
		throw new Error(
			`missing required template variables: ${missing.join(", ")}`,
		);
	}
}

function localesEqual(left: string, right: string): boolean {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function pickStoredLocale(
	rows: AthenaAuthEmailTemplateRow[],
	locale: string,
): AthenaAuthEmailTemplateRow | undefined {
	return rows.find((row) => localesEqual(row.locale, locale));
}

/**
 * Active localized stored override (plus `nl-NL`→`nl` prefix, case-insensitive)
 * → active `en` stored override
 * → reserved localized builtin (none today)
 * → Athena builtin default.
 * Inactive stored rows are excluded by the `is_active: true` filter.
 */
export async function resolveAuthEmailTemplate(
	store: AthenaAuthEmailStore,
	input: { eventType: string; locale?: string },
): Promise<AthenaAuthEmailTemplateRow | undefined> {
	const locale = input.locale?.trim() || "en";
	const definition = getAuthEmailEventDefinition(input.eventType);
	const templateKey = definition?.default_template_key ?? undefined;
	if (!templateKey) {
		return undefined;
	}

	const rows = await store.listTemplates({
		event_type: input.eventType,
		is_active: true,
		template_key: templateKey,
	});

	const exact = pickStoredLocale(rows, locale);
	if (exact) {
		return exact;
	}

	if (locale.includes("-")) {
		const prefix = locale.slice(0, locale.indexOf("-"));
		const byPrefix = pickStoredLocale(rows, prefix);
		if (byPrefix) {
			return byPrefix;
		}
	}

	if (!localesEqual(locale, "en")) {
		const fallbackEn = pickStoredLocale(rows, "en");
		if (fallbackEn) {
			return fallbackEn;
		}
	}

	return builtinTemplateRow(input.eventType, locale);
}
