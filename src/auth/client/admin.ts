import { assertAthenaAuthTemplateVariables } from "../limits.ts";
import { resolveReactEmailPayloadFields } from "../react-email.ts";
import type {
  AthenaAdminEmailTemplateGetQuery,
  AthenaAdminEmailTemplateGetResponse,
  AthenaAdminEmailTemplateListQuery,
  AthenaAdminEmailTemplateListResponse,
  AthenaAdminEmailTemplateRecord,
  AthenaAdminEmailTemplateSendResponse,
  AthenaAdminHasPermissionRequest,
  AthenaAdminHasPermissionResponse,
  AthenaAdminRevokeUserSessionRequest,
  AthenaAdminRevokeUserSessionsRequest,
  AthenaAdminSuccessResponse,
  AthenaAuthBindings,
  AthenaAuthCallOptions,
  AthenaAuthEndpointPath,
  AthenaAuthFetchCompatibleInput,
  AthenaAuthGenericInput,
  AthenaAuthGuardResult,
  AthenaAuthReactEmailRenderInput,
} from "../types.ts";
import type { AuthTransport } from "./transport.ts";

function copyDefinedField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  targetKey: string,
  sourceKey: string
): void {
  if (!(sourceKey in source)) {
    return;
  }
  const value = source[sourceKey];
  if (value !== undefined) {
    target[targetKey] = value;
  }
}

function normalizeEmailTemplateAttachmentsValue(value: unknown): unknown {
  if (typeof value === "string" || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeEmailTemplateAttachmentsValue(item));
  }

  if (typeof value !== "object") {
    return value;
  }

  const attachment = { ...(value as Record<string, unknown>) };
  copyDefinedField(attachment, attachment, "file_url", "fileUrl");
  attachment.fileUrl = undefined;
  return attachment;
}

function normalizeAdminEmailTemplatePayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...payload };

  copyDefinedField(normalized, payload, "template_key", "templateKey");
  copyDefinedField(normalized, payload, "event_type", "eventType");
  copyDefinedField(normalized, payload, "subject_template", "subjectTemplate");
  copyDefinedField(normalized, payload, "text_template", "textTemplate");
  copyDefinedField(normalized, payload, "html_template", "htmlTemplate");
  copyDefinedField(
    normalized,
    payload,
    "variable_bindings",
    "variableBindings"
  );
  copyDefinedField(
    normalized,
    payload,
    "attachment_failure_mode",
    "attachmentFailureMode"
  );
  copyDefinedField(normalized, payload, "is_active", "isActive");

  if (Object.hasOwn(payload, "attachments")) {
    normalized.attachments = normalizeEmailTemplateAttachmentsValue(
      payload.attachments
    );
  }

  normalized.templateKey = undefined;
  normalized.eventType = undefined;
  normalized.subjectTemplate = undefined;
  normalized.textTemplate = undefined;
  normalized.htmlTemplate = undefined;
  normalized.variableBindings = undefined;
  normalized.attachmentFailureMode = undefined;
  normalized.isActive = undefined;

  return normalized;
}

function toReactEmailTemplateCompatibilityInput<
  TInput extends AthenaAuthFetchCompatibleInput & {
    react?: AthenaAuthReactEmailRenderInput;
  },
>(input: TInput): TInput {
  const payload = input as Record<string, unknown>;
  const compatibility = { ...payload };

  copyDefinedField(compatibility, payload, "templateKey", "template_key");
  copyDefinedField(compatibility, payload, "eventType", "event_type");
  copyDefinedField(
    compatibility,
    payload,
    "subjectTemplate",
    "subject_template"
  );
  copyDefinedField(compatibility, payload, "textTemplate", "text_template");
  copyDefinedField(compatibility, payload, "htmlTemplate", "html_template");
  copyDefinedField(
    compatibility,
    payload,
    "variableBindings",
    "variable_bindings"
  );
  copyDefinedField(
    compatibility,
    payload,
    "attachmentFailureMode",
    "attachment_failure_mode"
  );
  copyDefinedField(compatibility, payload, "isActive", "is_active");

  return compatibility as unknown as TInput;
}

function normalizeAdminEmailTemplateSendPayload(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...payload };

  copyDefinedField(normalized, payload, "template_id", "templateId");
  copyDefinedField(normalized, payload, "recipient_email", "recipientEmail");
  copyDefinedField(normalized, payload, "render_variables", "renderVariables");
  copyDefinedField(normalized, payload, "user_id", "userId");
  copyDefinedField(normalized, payload, "organization_id", "organizationId");
  copyDefinedField(normalized, payload, "session_token", "sessionToken");
  copyDefinedField(
    normalized,
    payload,
    "attachment_failure_mode",
    "attachmentFailureMode"
  );

  if (Object.hasOwn(payload, "attachments")) {
    normalized.attachments = normalizeEmailTemplateAttachmentsValue(
      payload.attachments
    );
  }

  normalized.templateId = undefined;
  normalized.recipientEmail = undefined;
  normalized.renderVariables = undefined;
  normalized.userId = undefined;
  normalized.organizationId = undefined;
  normalized.sessionToken = undefined;
  normalized.attachmentFailureMode = undefined;

  return normalized;
}

export function createAdminClientModule(input: {
  requirePermission: (
    endpoint: "/admin/has-permission" | "/organization/has-permission",
    input: AthenaAdminHasPermissionRequest & AthenaAuthFetchCompatibleInput,
    options?: AthenaAuthCallOptions
  ) => Promise<AthenaAuthGuardResult>;
  transport: AuthTransport;
}) {
  const { requirePermission, transport } = input;
  const resolvedConfig = transport.resolvedConfig;

  const withReactEmailRoute = (route: AthenaAuthEndpointPath) => ({
    ...resolvedConfig.reactEmail,
    route,
  });

  const resolveAdminEmailPayload = <
    TInput extends AthenaAuthFetchCompatibleInput & {
      react?: AthenaAuthReactEmailRenderInput;
    },
  >(
    route: "/admin/email/create" | "/admin/email/update",
    input: TInput
  ) =>
    resolveReactEmailPayloadFields(
      input,
      {
        htmlField: "htmlBody",
        textField: "textBody",
      },
      withReactEmailRoute(route)
    );

  const resolveAdminEmailTemplatePayload = <
    TInput extends AthenaAuthFetchCompatibleInput & {
      react?: AthenaAuthReactEmailRenderInput;
    },
  >(
    route: "/admin/email-template/create" | "/admin/email-template/update",
    input: TInput
  ) =>
    resolveReactEmailPayloadFields(
      toReactEmailTemplateCompatibilityInput(input),
      {
        htmlField: "htmlTemplate",
        textField: "textTemplate",
        variablesField: "variables",
      },
      withReactEmailRoute(route)
    ).then((payload) => {
      const normalizedPayload = normalizeAdminEmailTemplatePayload(
        payload as Record<string, unknown>
      );
      if (
        "variables" in payload &&
        payload.variables !== undefined &&
        payload.variables !== null
      ) {
        assertAthenaAuthTemplateVariables(
          payload.variables,
          `${route} variables`
        );
      }
      return normalizedPayload;
    });

  const adminUserSessionRevokeBinding: AthenaAuthBindings["admin"]["user"]["session"]["revoke"] =
    (input, options) => {
      const requireUserId = (userId: string | undefined): string => {
        const trimmed = String(userId ?? "").trim();
        if (!trimmed) {
          throw new Error(
            "admin.user.session.revoke requires a non-empty userId"
          );
        }
        return trimmed;
      };

      const requireSinglePluralUserId = (
        sessions: AthenaAdminRevokeUserSessionRequest[]
      ): AthenaAdminRevokeUserSessionsRequest => {
        const uniqueUserIds = [
          ...new Set(sessions.map((session) => requireUserId(session.userId))),
        ];
        if (uniqueUserIds.length !== 1) {
          throw new Error(
            "admin.user.session.revoke requires the same userId across plural payloads"
          );
        }
        return { userId: uniqueUserIds[0] };
      };

      if (Array.isArray(input)) {
        if (input.length === 0) {
          throw new Error(
            "admin.user.session.revoke requires at least one payload item"
          );
        }
        if (input.length === 1) {
          return transport.postGeneric<AthenaAdminSuccessResponse>(
            "/admin/revoke-user-session",
            {
              ...input[0],
              userId: requireUserId(input[0].userId),
            } as AthenaAuthGenericInput,
            options
          );
        }
        return transport.postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          requireSinglePluralUserId(input),
          options
        );
      }

      const parsed = input as AthenaAuthGenericInput & {
        sessions?: AthenaAdminRevokeUserSessionRequest[];
        sessionToken?: string;
        userId?: string;
      };
      const sessions = parsed.sessions;

      if (sessions && sessions.length === 0) {
        throw new Error(
          "admin.user.session.revoke requires at least one payload item"
        );
      }

      if (sessions && sessions.length === 1) {
        return transport.postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-session",
          {
            ...sessions[0],
            fetchOptions: parsed.fetchOptions,
            userId: requireUserId(sessions[0].userId),
          } as AthenaAuthGenericInput,
          options
        );
      }

      if (sessions && sessions.length > 1) {
        return transport.postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          {
            ...requireSinglePluralUserId(sessions),
            fetchOptions: parsed.fetchOptions,
          } as AthenaAuthGenericInput,
          options
        );
      }

      const normalizedUserId = requireUserId(parsed.userId);

      if (!parsed.sessionToken) {
        return transport.postGeneric<AthenaAdminSuccessResponse>(
          "/admin/revoke-user-sessions",
          {
            fetchOptions: parsed.fetchOptions,
            userId: normalizedUserId,
          } as AthenaAuthGenericInput,
          options
        );
      }
      return transport.postGeneric<AthenaAdminSuccessResponse>(
        "/admin/revoke-user-session",
        {
          ...parsed,
          userId: normalizedUserId,
        } as AthenaAuthGenericInput,
        options
      );
    };

  const emailTemplate: AthenaAuthBindings["admin"]["emailTemplate"] = {
    create: async (input, options) =>
      transport.postGeneric<AthenaAdminEmailTemplateRecord>(
        "/admin/email-template/create",
        await resolveAdminEmailTemplatePayload(
          "/admin/email-template/create",
          input
        ),
        options
      ),
    delete: (input, options) =>
      transport.postGeneric<AthenaAdminSuccessResponse>(
        "/admin/email-template/delete",
        input,
        options
      ),
    get: (input, options) =>
      transport.getWithQuery<
        AthenaAdminEmailTemplateGetResponse,
        AthenaAdminEmailTemplateGetQuery
      >("/admin/email-template/get", input, options),
    list: (input, options) =>
      transport.getWithQuery<
        AthenaAdminEmailTemplateListResponse,
        AthenaAdminEmailTemplateListQuery
      >("/admin/email-template/list", input, options),
    send: (input, options) =>
      transport.postGeneric<AthenaAdminEmailTemplateSendResponse>(
        "/admin/email-template/send",
        normalizeAdminEmailTemplateSendPayload(
          transport.extractFetchOptions(input).payload as Record<
            string,
            unknown
          >
        ),
        options
      ),
    update: async (input, options) =>
      transport.postGeneric<AthenaAdminEmailTemplateRecord>(
        "/admin/email-template/update",
        await resolveAdminEmailTemplatePayload(
          "/admin/email-template/update",
          input
        ),
        options
      ),
  };

  const admin: AthenaAuthBindings["admin"] = {
    connection: {
      create: (input, options) =>
        transport.postGeneric(
          "/admin/identity-connection/create",
          input,
          options
        ),
      get: (input, options) =>
        transport.getWithQuery(
          "/admin/identity-connection/get",
          input,
          options
        ),
      list: (input, options) =>
        transport.getWithQuery(
          "/admin/identity-connection/list",
          input,
          options
        ),
      update: (input, options) =>
        transport.postGeneric(
          "/admin/identity-connection/update",
          input,
          options
        ),
      disable: (input, options) =>
        transport.postGeneric(
          "/admin/identity-connection/disable",
          input,
          options
        ),
    },
    apiKey: {
      create: (input, options) =>
        transport.postGeneric("/admin/api-key/create", input, options),
    },
    athenaClient: {
      create: (input, options) =>
        transport.postGeneric("/admin/athena-client/create", input, options),
      list: (input, options) =>
        transport.getWithQuery("/admin/athena-client/list", input, options),
    },
    auditLog: {
      list: (input, options) =>
        transport.getWithQuery("/admin/audit-log/list", input, options),
    },
    authorizationServer: {
      client: {
        create: (input, options) =>
          transport.postGeneric(
            "/admin/authorization-server/client/create",
            input,
            options
          ),
        disable: (input, options) =>
          transport.postGeneric(
            "/admin/authorization-server/client/disable",
            input,
            options
          ),
        get: (input, options) =>
          transport.getWithQuery(
            "/admin/authorization-server/client/get",
            input,
            options
          ),
        list: (input, options) =>
          transport.getWithQuery(
            "/admin/authorization-server/client/list",
            input,
            options
          ),
        update: (input, options) =>
          transport.postGeneric(
            "/admin/authorization-server/client/update",
            input,
            options
          ),
      },
      grant: {
        list: (input, options) => {
          // Empty query text means an explicit SQL NULL organization filter.
          const query =
            input?.query?.organizationId === null
              ? {
                  ...input,
                  query: { ...input.query, organizationId: "" },
                }
              : input;
          return transport.getWithQuery(
            "/admin/authorization-server/grant/list",
            query,
            options
          );
        },
        revoke: (input, options) =>
          transport.postGeneric(
            "/admin/authorization-server/grant/revoke",
            input,
            options
          ),
      },
    },
    banUser: (input, options) =>
      transport.postGeneric("/admin/ban-user", input, options),
    createUser: (input, options) =>
      transport.postGeneric("/admin/create-user", input, options),
    email: {
      create: async (input, options) =>
        transport.postGeneric(
          "/admin/email/create",
          await resolveAdminEmailPayload("/admin/email/create", input),
          options
        ),
      delete: (input, options) =>
        transport.postGeneric("/admin/email/delete", input, options),
      eventType: {
        list: (input, options) =>
          transport.getWithQuery(
            "/admin/email-event-type/list",
            input,
            options
          ),
      },
      failure: {
        create: (input, options) =>
          transport.postGeneric("/admin/email-failure/create", input, options),
        delete: (input, options) =>
          transport.postGeneric("/admin/email-failure/delete", input, options),
        get: (input, options) =>
          transport.getWithQuery("/admin/email-failure/get", input, options),
        list: (input, options) =>
          transport.getWithQuery("/admin/email-failure/list", input, options),
        update: (input, options) =>
          transport.postGeneric("/admin/email-failure/update", input, options),
      },
      get: (input, options) =>
        transport.getWithQuery("/admin/email/get", input, options),
      list: (input, options) =>
        transport.getWithQuery("/admin/email/list", input, options),
      template: emailTemplate,
      update: async (input, options) =>
        transport.postGeneric(
          "/admin/email/update",
          await resolveAdminEmailPayload("/admin/email/update", input),
          options
        ),
    },
    emailEventType: {
      list: (input, options) =>
        transport.getWithQuery("/admin/email-event-type/list", input, options),
    },
    emailTemplate,
    getUser: (input, options) =>
      transport.getWithQuery("/admin/get-user", input, options),
    hasPermission: (input, options) =>
      transport.postGeneric<AthenaAdminHasPermissionResponse>(
        "/admin/has-permission",
        input,
        options
      ),
    impersonateUser: (input, options) =>
      transport.postGeneric("/admin/impersonate-user", input, options),
    listUsers: (input, options) =>
      transport.getWithQuery("/admin/list-users", input, options),
    removeUser: (input, options) =>
      transport.postGeneric("/admin/remove-user", input, options),
    requirePermission: (input, options) =>
      requirePermission("/admin/has-permission", input, options),
    revokeUserSessions: adminUserSessionRevokeBinding,
    role: {
      set: (input, options) =>
        transport.postGeneric("/admin/set-role", input, options),
    },
    setRole: (input, options) =>
      transport.postGeneric("/admin/set-role", input, options),
    stopImpersonating: (input, options) =>
      transport.postGeneric("/admin/stop-impersonating", input, options),
    unbanUser: (input, options) =>
      transport.postGeneric("/admin/unban-user", input, options),
    updateUser: (input, options) =>
      transport.postGeneric("/admin/update-user", input, options),
    user: {
      ban: (input, options) =>
        transport.postGeneric("/admin/ban-user", input, options),
      create: (input, options) =>
        transport.postGeneric("/admin/create-user", input, options),
      get: (input, options) =>
        transport.getWithQuery("/admin/get-user", input, options),
      impersonate: (input, options) =>
        transport.postGeneric("/admin/impersonate-user", input, options),
      list: (input, options) =>
        transport.getWithQuery("/admin/list-users", input, options),
      remove: (input, options) =>
        transport.postGeneric("/admin/remove-user", input, options),
      session: {
        list: (input, options) =>
          transport.postGeneric("/admin/list-user-sessions", input, options),
        revoke: adminUserSessionRevokeBinding,
      },
      setPassword: (input, options) =>
        transport.postGeneric("/admin/set-user-password", input, options),
      stopImpersonating: (input, options) =>
        transport.postGeneric("/admin/stop-impersonating", input, options),
      unban: (input, options) =>
        transport.postGeneric("/admin/unban-user", input, options),
      update: (input, options) =>
        transport.postGeneric("/admin/update-user", input, options),
    },
  };

  return { admin };
}
