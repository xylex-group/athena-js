import type { AthenaEmailTemplateStore } from "../../../email/types.ts";
import type { AthenaAuthRuntime } from "../runtime-types.ts";

export function createEmbeddedAuthEmailTemplateStore(
  runtime: Pick<AthenaAuthRuntime, "getEmailStore" | "getStores">
): AthenaEmailTemplateStore {
  return {
    listTemplates: async (selector) => {
      await runtime.getStores();
      const rows = await runtime.getEmailStore().listTemplates({
        event_type: selector?.eventType,
        is_active: true,
        template_key: selector?.templateKey,
      });
      return rows.map((row) => ({
        attachmentFailureMode: row.attachment_failure_mode ?? undefined,
        attachments: row.attachments?.map((attachment) => ({
          fileUrl: attachment.file_url,
          ...(attachment.filename ? { filename: attachment.filename } : {}),
        })),
        eventType: row.event_type ?? undefined,
        htmlTemplate: row.html_template ?? undefined,
        id: row.id,
        isActive: row.is_active,
        locale: row.locale,
        subjectTemplate: row.subject_template,
        templateKey: row.template_key,
        textTemplate: row.text_template ?? undefined,
        variableBindings: row.variable_bindings,
        variables: row.variables,
      }));
    },
  };
}
