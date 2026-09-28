import {
  ATHENA_EMAIL_MESSAGE_INVALID,
  ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED,
  AthenaEmailError,
} from "../../email/errors.ts";
import type {
  AthenaEmailDeliveryPort,
  AthenaEmailMessage,
} from "../../email/types.ts";
import type { AthenaAuthEmailStore } from "../local/email/store.ts";
import {
  assertAuthEmailRequiredVariables,
  flattenAuthEmailTemplateData,
  resolveAuthEmailTemplate,
} from "./catalog.ts";
import { ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED } from "./contract.ts";
import { renderAuthEmailFragment } from "./renderer.ts";

export interface EmitAuthEmailInput {
  data: Record<string, string>;
  eventType: string;
  flow?: string;
  locale?: string;
  recipient: string;
}

export type LegacyAuthEmailSend = (message: {
  subject: string;
  to: string;
  type: string;
  url?: string;
}) => Promise<void> | void;

export interface EmitAuthEmailContext {
  defaultFrom?: string;
  defaultFromName?: string;
  delivery?: AthenaEmailDeliveryPort;
  legacySend?: LegacyAuthEmailSend;
  store: AthenaAuthEmailStore;
}

const LEGACY_TYPE: Record<string, string> = {
  "organization.member.invite": "organization-invite",
  "user.account.delete.confirmation": "delete-account",
  "user.email.change.confirmation": "change-email",
  "user.email.verify": "verify-email",
  "user.password.reset": "reset-password",
  "user.sign-in.email": "magic-link",
  "user.sign-in.otp": "two-factor-otp",
};

function nowIso(): string {
  return new Date().toISOString();
}

function secretsFromData(data: Record<string, string>): string[] {
  const secrets: string[] = [];
  if (data.otp_code) {
    secrets.push(data.otp_code);
  }
  for (const value of Object.values(data)) {
    const token = /[?&]token=([^&]+)/.exec(value)?.[1];
    if (token) {
      try {
        secrets.push(decodeURIComponent(token));
      } catch {
        secrets.push(token);
      }
    }
    if (
      /^(verify_|change_|delete_|reset_)/.test(value) ||
      /^[0-9a-f-]{36}$/i.test(value)
    ) {
      secrets.push(value);
    }
  }
  return [...new Set(secrets.filter((entry) => entry.length >= 6))];
}

function redact(
  value: string | null | undefined,
  secrets: string[]
): string | null {
  if (!value) {
    return value ?? null;
  }
  let next = value;
  for (const secret of secrets) {
    next = next.split(secret).join("[redacted]");
  }
  return next;
}

function hookUrl(data: Record<string, string>): string | undefined {
  return (
    data.legacy_hook_url ??
    data.verification_url ??
    data.reset_url ??
    data.invitation_url ??
    data.sign_in_url ??
    data.otp_code
  );
}

export function authEmailFailureFromDeliveryError(error: unknown): {
  errorCode: string;
  errorMessage: string;
} {
  if (error instanceof AthenaEmailError) {
    if (error.code === ATHENA_EMAIL_PROVIDER_NOT_CONFIGURED) {
      return {
        errorCode: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
        errorMessage: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
      };
    }
    return {
      errorCode: error.code,
      errorMessage: error.message,
    };
  }
  return {
    errorCode: "ATHENA_EMAIL_DELIVERY_FAILED",
    errorMessage: error instanceof Error ? error.message : String(error),
  };
}

export async function emitAuthEmail(
  input: EmitAuthEmailInput,
  ctx: EmitAuthEmailContext
): Promise<{ success: boolean }> {
  if (!ctx.defaultFrom?.trim() && process.env.NODE_ENV === "production") {
    throw new AthenaEmailError(
      ATHENA_EMAIL_MESSAGE_INVALID,
      "Production Auth email requires a from-authority (email.defaults.from)."
    );
  }
  const locale = input.locale?.trim() || "en";
  const flow = input.flow ?? input.eventType;
  const template = await resolveAuthEmailTemplate(ctx.store, {
    eventType: input.eventType,
    locale,
  });
  if (!template) {
    return { success: false };
  }

  const data = {
    app_name: "Athena",
    ...flattenAuthEmailTemplateData(input.eventType, input.data),
  };
  const stamp = nowIso();
  const templateId = template.id.startsWith("builtin:") ? null : template.id;
  try {
    assertAuthEmailRequiredVariables(input.eventType, data);
  } catch (error) {
    await ctx.store.createFailure({
      created_at: stamp,
      error_message: error instanceof Error ? error.message : String(error),
      flow,
      id: crypto.randomUUID(),
      metadata: { event_type: input.eventType },
      recipient_email: input.recipient,
      resolved: false,
      template_id: templateId,
      template_key: template.template_key,
      updated_at: stamp,
    });
    return { success: false };
  }

  const subject = renderAuthEmailFragment(template.subject_template, data);
  const html = template.html_template
    ? renderAuthEmailFragment(template.html_template, data)
    : undefined;
  const text = template.text_template
    ? renderAuthEmailFragment(template.text_template, data)
    : undefined;
  const secrets = secretsFromData(data);

  const invokeLegacy = async () => {
    if (!ctx.legacySend) {
      return;
    }
    await ctx.legacySend({
      subject,
      to: input.recipient,
      type: LEGACY_TYPE[input.eventType] ?? input.eventType,
      url: hookUrl(data),
    });
  };

  const delivery = ctx.delivery;
  if (!delivery) {
    await ctx.store.createFailure({
      created_at: stamp,
      error_code: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
      error_message: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
      flow,
      id: crypto.randomUUID(),
      metadata: { event_type: input.eventType },
      recipient_email: input.recipient,
      resolved: false,
      template_id: templateId,
      template_key: template.template_key,
      updated_at: stamp,
    });
    await invokeLegacy();
    return { success: false };
  }

  const resolvedFrom = ctx.defaultFrom?.trim() || undefined;
  const resolvedFromName = ctx.defaultFromName?.trim() || undefined;
  const message: AthenaEmailMessage = {
    ...(resolvedFrom ? { from: resolvedFrom } : {}),
    ...(resolvedFromName ? { fromName: resolvedFromName } : {}),
    html,
    metadata: {
      event_type: input.eventType,
      flow,
      template_id: templateId,
      template_key: template.template_key,
    },
    subject,
    text,
    to: input.recipient,
  };
  const emailId = crypto.randomUUID();
  const submittedAt = stamp;
  await ctx.store.createEmail({
    created_at: submittedAt,
    flow,
    from_address: message.from ?? "athena@localhost",
    from_name: message.fromName ?? null,
    html_body: redact(html, secrets),
    id: emailId,
    metadata: {
      delivery_status: "submitted",
      event_type: input.eventType,
      template_key: template.template_key,
    },
    provider: "pending",
    recipient_email: input.recipient,
    subject: redact(subject, secrets) ?? subject,
    text_body: redact(text, secrets),
    updated_at: submittedAt,
  });

  const persistFailed = async (failure: {
    errorCode: string;
    errorMessage: string;
    provider?: string | null;
  }) => {
    const failedAt = nowIso();
    const existing = await ctx.store.getEmail(emailId);
    await ctx.store.updateEmail(emailId, {
      metadata: {
        ...(existing?.metadata ?? {}),
        delivery_status: "failed",
        failure_reason: redact(failure.errorMessage, secrets),
      },
      provider: failure.provider ?? "failed",
      updated_at: failedAt,
    });
    await ctx.store.createFailure({
      created_at: failedAt,
      error_code: failure.errorCode,
      error_message:
        redact(failure.errorMessage, secrets) ?? failure.errorMessage,
      flow,
      id: crypto.randomUUID(),
      metadata: { email_id: emailId, event_type: input.eventType },
      provider: failure.provider,
      recipient_email: input.recipient,
      resolved: false,
      template_id: templateId,
      template_key: template.template_key,
      updated_at: failedAt,
    });
  };

  let result: Awaited<ReturnType<typeof delivery.send>>;
  try {
    result = await delivery.send(message);
  } catch (error) {
    const mapped = authEmailFailureFromDeliveryError(error);
    await persistFailed({
      errorCode: mapped.errorCode,
      errorMessage: mapped.errorMessage,
    });
    return { success: false };
  }
  if (!result.success) {
    await persistFailed({
      errorCode: "ATHENA_EMAIL_DELIVERY_FAILED",
      errorMessage: "Email delivery failed",
      provider: result.provider,
    });
    return { success: false };
  }
  try {
    const existing = await ctx.store.getEmail(emailId);
    await ctx.store.updateEmail(emailId, {
      from_address: result.from ?? message.from ?? "athena@localhost",
      from_name: result.fromName ?? message.fromName ?? null,
      metadata: {
        ...(existing?.metadata ?? {}),
        delivery_status: "accepted",
        ...(result.messageId ? { provider_message_id: result.messageId } : {}),
      },
      provider: result.provider,
      updated_at: nowIso(),
    });
  } catch {
    // Delivery already succeeded; audit errors must not rewrite it.
  }
  return { success: true };
}

export function createTransactionalMailer(ctx: EmitAuthEmailContext) {
  return {
    emit(input: EmitAuthEmailInput) {
      return emitAuthEmail(input, ctx);
    },
  };
}
