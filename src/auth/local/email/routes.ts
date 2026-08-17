import { resolveTemplateAttachments } from "../../email/attachments.ts";
import { resolveEmailBindings } from "../../email/bindings.ts";
import { AthenaAuthEmailError } from "../../email/errors.ts";
import {
  ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
  type AthenaAuthEmailAttachmentFailureMode,
  type AthenaAuthEmailProvider,
  type AthenaAuthEmailTemplateRow,
} from "../../email/contract.ts";

import { renderAuthEmailFragment } from "../../email/renderer.ts";
import { AthenaAuthRuntimeError, jsonResponse } from "../errors.ts";
import type { AthenaAuthStores } from "../memory-stores.ts";
import { ATHENA_AUTH_MAX_ADMIN_JSON_BYTES } from "../../limits.ts";
import { asStringField, readJsonBody, requireStringField } from "../security.ts";
import type { AthenaAuthEmailStore } from "./store.ts";

export interface AdminEmailRouteContext {
  emailStore: AthenaAuthEmailStore;
  headers: Headers;
  provider?: AthenaAuthEmailProvider;
  requireSession: (
    request: Request,
    stores: AthenaAuthStores
  ) => Promise<{ user: { role: string | null } }>;
  stores: AthenaAuthStores;
}

function pickRequired(body: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = asStringField(body, key)?.trim();
    if (value) {
      return value;
    }
  }
  throw AthenaAuthRuntimeError.badRequest(`${keys[0]} is required`);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseAttachments(value: unknown): AthenaAuthEmailTemplateRow["attachments"] {
  if (!value) {
    return [];
  }
  const items = Array.isArray(value) ? value : [value];
  return items.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      return [{ file_url: item.trim() }];
    }
    const record = asRecord(item);
    const fileUrl =
      asStringField(record, "file_url") ?? asStringField(record, "fileUrl");
    if (!fileUrl) {
      return [];
    }
    const filename = asStringField(record, "filename") ?? undefined;
    return [{ file_url: fileUrl, filename }];
  });
}

function parseBindings(value: unknown): AthenaAuthEmailTemplateRow["variable_bindings"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => {
    const record = asRecord(item);
    const name = asStringField(record, "name");
    const source = asStringField(record, "source");
    if (!name || !source) {
      return [];
    }
    return [
      {
        name,
        required: record.required === true,
        source,
      },
    ];
  });
}

function parseFailureMode(value: unknown): AthenaAuthEmailAttachmentFailureMode {
  return value === "skip" ? "skip" : "fail";
}

function nowIso(): string {
  return new Date().toISOString();
}

async function requireAdmin(
  request: Request,
  ctx: AdminEmailRouteContext
): Promise<void> {
  const resolved = await ctx.requireSession(request, ctx.stores);
  const role = resolved.user.role;
  if (role !== "admin" && role !== "owner") {
    throw AthenaAuthRuntimeError.forbidden();
  }
}

function templatePayload(body: Record<string, unknown>): Omit<
  AthenaAuthEmailTemplateRow,
  "created_at" | "id" | "updated_at"
> {
  const templateKey =
    asStringField(body, "template_key") ?? asStringField(body, "templateKey");
  const subject =
    asStringField(body, "subject_template") ??
    asStringField(body, "subjectTemplate");
  if (!templateKey || !subject) {
    throw AthenaAuthRuntimeError.badRequest(
      "template_key and subject_template are required"
    );
  }
  return {
    attachment_failure_mode: parseFailureMode(
      body.attachment_failure_mode ?? body.attachmentFailureMode
    ),
    attachments: parseAttachments(body.attachments),
    event_type:
      asStringField(body, "event_type") ??
      asStringField(body, "eventType") ??
      null,
    html_template:
      asStringField(body, "html_template") ??
      asStringField(body, "htmlTemplate") ??
      null,
    is_active: body.is_active === false || body.isActive === false ? false : true,
    locale: asStringField(body, "locale") ?? "en",
    metadata: asRecord(body.metadata),
    subject_template: subject,
    template_key: templateKey,
    text_template:
      asStringField(body, "text_template") ??
      asStringField(body, "textTemplate") ??
      null,
    variable_bindings: parseBindings(
      body.variable_bindings ?? body.variableBindings
    ),
    variables: asStringArray(body.variables),
  };
}

export async function handleAdminEmailRoutes(
  request: Request,
  path: string,
  method: string,
  ctx: AdminEmailRouteContext
): Promise<Response | null> {
  if (!path.startsWith("/admin/email")) {
    return null;
  }
  await requireAdmin(request, ctx);
  const url = new URL(request.url);

  if (path === "/admin/email-event-type/list" && method === "GET") {
    const category = url.searchParams.get("category") ?? undefined;
    const rows = (await ctx.emailStore.listEventTypes()).filter(
      (entry) => !category || entry.category === category
    );
    return jsonResponse(
      200,
      {
        emailEventTypes: rows,
        event_types: rows,
        limit: rows.length,
        total: rows.length,
      },
      ctx.headers
    );
  }

  if (path === "/admin/email-template/list" && method === "GET") {
    const isActive = url.searchParams.get("is_active") ?? url.searchParams.get("isActive");
    const rows = await ctx.emailStore.listTemplates({
      event_type:
        url.searchParams.get("event_type") ??
        url.searchParams.get("eventType") ??
        undefined,
      is_active: isActive === null ? undefined : isActive === "true",
      locale: url.searchParams.get("locale") ?? undefined,
      template_key:
        url.searchParams.get("template_key") ??
        url.searchParams.get("templateKey") ??
        undefined,
    });
    return jsonResponse(
      200,
      {
        email_templates: rows,
        limit: rows.length,
        offset: 0,
        total: rows.length,
      },
      ctx.headers
    );
  }

  if (path === "/admin/email-template/get" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      throw AthenaAuthRuntimeError.badRequest("id is required");
    }
    const row = await ctx.emailStore.getTemplate(id);
    if (!row) {
      throw AthenaAuthRuntimeError.notFound("Email template not found");
    }
    return jsonResponse(200, { email_template: row }, ctx.headers);
  }

  if (path === "/admin/email-template/create" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const stamp = nowIso();
    const row = await ctx.emailStore.createTemplate({
      ...templatePayload(body),
      created_at: stamp,
      id: crypto.randomUUID(),
      updated_at: stamp,
    });
    return jsonResponse(200, row, ctx.headers);
  }

  if (path === "/admin/email-template/update" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const id = requireStringField(body, "id");
    const existing = await ctx.emailStore.getTemplate(id);
    if (!existing) {
      throw AthenaAuthRuntimeError.notFound("Email template not found");
    }
    const next = await ctx.emailStore.updateTemplate(id, templatePayload({
      ...existing,
      ...body,
      subject_template:
        asStringField(body, "subject_template") ??
        asStringField(body, "subjectTemplate") ??
        existing.subject_template,
      template_key:
        asStringField(body, "template_key") ??
        asStringField(body, "templateKey") ??
        existing.template_key,
    }));
    return jsonResponse(200, next, ctx.headers);
  }

  if (path === "/admin/email-template/delete" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const id = requireStringField(body, "id");
    const deleted = await ctx.emailStore.deleteTemplate(id);
    if (!deleted) {
      throw AthenaAuthRuntimeError.notFound("Email template not found");
    }
    return jsonResponse(200, { success: true }, ctx.headers);
  }

  if (path === "/admin/email-template/send" && method === "POST") {
    return sendStoredTemplate(request, ctx);
  }

  if (path === "/admin/email-failure/list" && method === "GET") {
    const rows = await ctx.emailStore.listFailures();
    return jsonResponse(
      200,
      {
        emailSendFailures: rows,
        email_send_failures: rows,
        total: rows.length,
      },
      ctx.headers
    );
  }

  if (path === "/admin/email-failure/get" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      throw AthenaAuthRuntimeError.badRequest("id is required");
    }
    const row = await ctx.emailStore.getFailure(id);
    if (!row) {
      throw AthenaAuthRuntimeError.notFound("Email failure not found");
    }
    return jsonResponse(200, { email_send_failure: row }, ctx.headers);
  }

  if (path === "/admin/email-failure/create" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const stamp = nowIso();
    const row = await ctx.emailStore.createFailure({
      created_at: stamp,
      error_message: pickRequired(body, "error_message", "errorMessage"),
      flow: asStringField(body, "flow") ?? "admin.email_failure.create",
      id: crypto.randomUUID(),
      metadata: asRecord(body.metadata),
      recipient_email: pickRequired(body, "recipient_email", "recipientEmail"),
      resolved: false,
      updated_at: stamp,
    });
    return jsonResponse(200, row, ctx.headers);
  }

  if (path === "/admin/email-failure/update" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const id = requireStringField(body, "id");
    const next = await ctx.emailStore.updateFailure(id, {
      resolved: typeof body.resolved === "boolean" ? body.resolved : undefined,
      resolution_note:
        asStringField(body, "resolution_note") ??
        asStringField(body, "resolutionNote"),
    });
    if (!next) {
      throw AthenaAuthRuntimeError.notFound("Email failure not found");
    }
    return jsonResponse(200, next, ctx.headers);
  }

  if (path === "/admin/email-failure/delete" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const deleted = await ctx.emailStore.deleteFailure(requireStringField(body, "id"));
    if (!deleted) {
      throw AthenaAuthRuntimeError.notFound("Email failure not found");
    }
    return jsonResponse(200, { success: true }, ctx.headers);
  }

  if (path === "/admin/email/list" && method === "GET") {
    const rows = await ctx.emailStore.listEmails();
    return jsonResponse(200, { emails: rows, total: rows.length }, ctx.headers);
  }

  if (path === "/admin/email/get" && method === "GET") {
    const id = url.searchParams.get("id");
    if (!id) {
      throw AthenaAuthRuntimeError.badRequest("id is required");
    }
    const row = await ctx.emailStore.getEmail(id);
    if (!row) {
      throw AthenaAuthRuntimeError.notFound("Email not found");
    }
    return jsonResponse(200, { email: row }, ctx.headers);
  }

  if (path === "/admin/email/create" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const stamp = nowIso();
    const row = await ctx.emailStore.createEmail({
      created_at: stamp,
      flow: asStringField(body, "flow") ?? null,
      from_address:
        asStringField(body, "from_address") ??
        asStringField(body, "fromAddress") ??
        "athena@localhost",
      from_name:
        asStringField(body, "from_name") ?? asStringField(body, "fromName") ?? null,
      html_body:
        asStringField(body, "html_body") ?? asStringField(body, "htmlBody") ?? null,
      id: crypto.randomUUID(),
      metadata: asRecord(body.metadata),
      provider: asStringField(body, "provider") ?? "unknown",
      recipient_email: pickRequired(body, "recipient_email", "recipientEmail"),
      subject: requireStringField(body, "subject"),
      text_body:
        asStringField(body, "text_body") ?? asStringField(body, "textBody") ?? null,
      updated_at: stamp,
    });
    return jsonResponse(200, row, ctx.headers);
  }

  if (path === "/admin/email/update" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const next = await ctx.emailStore.updateEmail(requireStringField(body, "id"), {
      subject: asStringField(body, "subject") ?? undefined,
    });
    if (!next) {
      throw AthenaAuthRuntimeError.notFound("Email not found");
    }
    return jsonResponse(200, next, ctx.headers);
  }

  if (path === "/admin/email/delete" && method === "POST") {
    const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
    const deleted = await ctx.emailStore.deleteEmail(requireStringField(body, "id"));
    if (!deleted) {
      throw AthenaAuthRuntimeError.notFound("Email not found");
    }
    return jsonResponse(200, { success: true }, ctx.headers);
  }

  return null;
}

async function persistFailure(
  ctx: AdminEmailRouteContext,
  input: {
    errorCode?: string;
    errorMessage: string;
    recipientEmail: string;
    templateId?: string | null;
    templateKey?: string | null;
  }
) {
  const stamp = nowIso();
  return ctx.emailStore.createFailure({
    created_at: stamp,
    error_code: input.errorCode,
    error_message: input.errorMessage,
    flow: "admin.email_template.send",
    id: crypto.randomUUID(),
    metadata: {},
    recipient_email: input.recipientEmail,
    resolved: false,
    template_id: input.templateId,
    template_key: input.templateKey,
    updated_at: stamp,
  });
}

async function sendStoredTemplate(
  request: Request,
  ctx: AdminEmailRouteContext
): Promise<Response> {
  const body = asRecord(await readJsonBody(request, ATHENA_AUTH_MAX_ADMIN_JSON_BYTES));
  const templateId = pickRequired(body, "template_id", "templateId");
  const recipientEmail = pickRequired(body, "recipient_email", "recipientEmail");
  const template = await ctx.emailStore.getTemplate(templateId);
  if (!template) {
    throw AthenaAuthRuntimeError.notFound("Email template not found");
  }
  if (!template.is_active) {
    throw AthenaAuthRuntimeError.badRequest("Email template is inactive");
  }

  const renderVariables = asRecord(body.render_variables ?? body.renderVariables);
  const explicit: Record<string, string> = {};
  for (const [key, value] of Object.entries(renderVariables)) {
    if (typeof value === "string") {
      explicit[key] = value;
    }
  }

  let variables: Record<string, string>;
  let attachments: ReturnType<typeof parseAttachments>;
  try {
    variables = await resolveEmailBindings(
    ctx.stores,
    template.variable_bindings,
    explicit,
    {
      organizationId:
        asStringField(body, "organization_id") ??
        asStringField(body, "organizationId") ??
        undefined,
      sessionToken:
        asStringField(body, "session_token") ??
        asStringField(body, "sessionToken") ??
        undefined,
      userId: asStringField(body, "user_id") ?? asStringField(body, "userId") ?? undefined,
    }
    );
    attachments = resolveTemplateAttachments(
      [
        ...template.attachments,
        ...parseAttachments(body.attachments),
      ],
      parseFailureMode(
        body.attachment_failure_mode ??
          body.attachmentFailureMode ??
          template.attachment_failure_mode
      )
    );
  } catch (error) {
    if (error instanceof AthenaAuthEmailError) {
      throw new AthenaAuthRuntimeError(error.status, error.message);
    }
    throw error;
  }

  const subject = renderAuthEmailFragment(template.subject_template, variables);
  const html = template.html_template
    ? renderAuthEmailFragment(template.html_template, variables)
    : undefined;
  const text = template.text_template
    ? renderAuthEmailFragment(template.text_template, variables)
    : undefined;

  if (!ctx.provider) {
    const failure = await persistFailure(ctx, {
      errorCode: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
      errorMessage: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
      recipientEmail,
      templateId: template.id,
      templateKey: template.template_key,
    });
    return jsonResponse(
      503,
      {
        email_send_failure_id: failure.id,
        error: ATHENA_AUTH_EMAIL_PROVIDER_NOT_CONFIGURED,
        event_type: template.event_type,
        flow: "admin.email_template.send",
        recipient_email: recipientEmail,
        subject,
        success: false,
        template_id: template.id,
        template_key: template.template_key,
      },
      ctx.headers
    );
  }

  const result = await ctx.provider.send(
    {
      attachments,
      html,
      subject,
      text,
      to: recipientEmail,
    },
    {
      eventType: template.event_type,
      flow: "admin.email_template.send",
      templateId: template.id,
      templateKey: template.template_key,
    }
  );

  const stamp = nowIso();
  await ctx.emailStore.createEmail({
    created_at: stamp,
    flow: "admin.email_template.send",
    from_address: "athena@localhost",
    from_name: null,
    html_body: html ?? null,
    id: crypto.randomUUID(),
    metadata: result.metadata ?? {},
    provider: result.provider,
    recipient_email: recipientEmail,
    subject,
    text_body: text ?? null,
    updated_at: stamp,
  });

  return jsonResponse(
    200,
    {
      attachment_count: attachments.length,
      event_type: template.event_type,
      flow: "admin.email_template.send",
      recipient_email: recipientEmail,
      subject,
      success: result.success,
      template_id: template.id,
      template_key: template.template_key,
    },
    ctx.headers
  );
}
