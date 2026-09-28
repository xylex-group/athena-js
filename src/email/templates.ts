import {
  ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED,
  ATHENA_EMAIL_TEMPLATE_INVALID,
  ATHENA_EMAIL_TEMPLATE_NOT_FOUND,
  ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE,
  ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING,
  AthenaEmailError,
} from "./errors.ts";
import type {
  AthenaEmailDeliveryResult,
  AthenaEmailMessage,
  AthenaEmailTemplate,
  AthenaEmailTemplateRenderInput,
  AthenaEmailTemplateSelector,
  AthenaEmailTemplateStore,
  AthenaEmailTemplatesModule,
  AthenaRenderedEmailTemplate,
} from "./types.ts";

type SendEmail = (
  message: AthenaEmailMessage
) => Promise<AthenaEmailDeliveryResult>;
type TemplateStoreSource =
  | AthenaEmailTemplateStore
  | (() => AthenaEmailTemplateStore | undefined)
  | undefined;

const TEMPLATE_VARIABLE_PATTERN = /{{\s*([A-Za-z0-9_.-]+)\s*}}/g;

function selectorDescription(input: AthenaEmailTemplateSelector): string {
  return [
    input.templateKey && `templateKey=${input.templateKey}`,
    input.eventType && `eventType=${input.eventType}`,
    input.locale && `locale=${input.locale}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function assertSelector(input: AthenaEmailTemplateSelector): void {
  if (!(input.templateKey || input.eventType)) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_TEMPLATE_NOT_FOUND,
      "An email templateKey or eventType is required to resolve an email template."
    );
  }
}

function localeCandidates(locale: string): string[] {
  const normalized = locale.trim().toLowerCase();
  const candidates = [normalized];
  const language = normalized.split("-")[0];
  if (language && language !== normalized) {
    candidates.push(language);
  }
  if (!candidates.includes("en")) {
    candidates.push("en");
  }
  return candidates;
}

function templateVariables(template: AthenaEmailTemplate): {
  optional: string[];
  required: string[];
} {
  const required = new Set(template.variables ?? []);
  const optional = new Set<string>();
  for (const binding of template.variableBindings ?? []) {
    if (binding.required === false) {
      required.delete(binding.name);
      optional.add(binding.name);
    } else {
      optional.delete(binding.name);
      required.add(binding.name);
    }
  }
  const referenced = new Set<string>();
  for (const source of [
    template.subject ?? template.subjectTemplate,
    template.html ?? template.htmlTemplate,
    template.text ?? template.textTemplate,
  ]) {
    if (!source) {
      continue;
    }
    for (const match of source.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
      referenced.add(match[1]);
    }
  }
  for (const name of referenced) {
    if (!optional.has(name)) {
      required.add(name);
    }
  }
  return {
    optional: [...optional],
    required: [...required],
  };
}

function validateTemplate(template: AthenaEmailTemplate): void {
  const subject = template.subject ?? template.subjectTemplate;
  const html = template.html ?? template.htmlTemplate;
  const text = template.text ?? template.textTemplate;
  if (!(template.locale.trim() && subject?.trim() && (html || text))) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_TEMPLATE_INVALID,
      "Email templates require a locale, subjectTemplate, and htmlTemplate or textTemplate."
    );
  }
}

function stringifyVariables(
  variables: Readonly<Record<string, unknown>> | undefined,
  variableSets: { optional: readonly string[]; required: readonly string[] }
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  const missing: string[] = [];
  const optional = new Set(variableSets.optional);
  for (const name of [...variableSets.required, ...variableSets.optional]) {
    const value = variables?.[name];
    if (value === undefined || value === null) {
      if (optional.has(name)) {
        result[name] = "";
      } else {
        missing.push(name);
      }
      continue;
    }
    const stringValue = typeof value === "string" ? value : String(value);
    if (!optional.has(name) && stringValue.trim().length === 0) {
      missing.push(name);
      continue;
    }
    result[name] = stringValue;
  }
  if (missing.length > 0) {
    throw new AthenaEmailError(
      ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING,
      `Email template variables are missing: ${missing.join(", ")}.`,
      { cause: missing }
    );
  }
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "'": "&#39;",
        '"': "&quot;",
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
      })[character] ?? character
  );
}

function interpolate(
  source: string,
  variables: Readonly<Record<string, string>>,
  html: boolean
): string {
  return source.replace(TEMPLATE_VARIABLE_PATTERN, (_match, name: string) =>
    html ? escapeHtml(variables[name]) : variables[name]
  );
}

function createTemplateModule(
  storeSource: TemplateStoreSource,
  sendEmail: SendEmail,
  defaultLocale?: string
): AthenaEmailTemplatesModule {
  async function listTemplates(
    selector: AthenaEmailTemplateSelector
  ): Promise<readonly AthenaEmailTemplate[]> {
    const store =
      typeof storeSource === "function" ? storeSource() : storeSource;
    if (!store) {
      throw new AthenaEmailError(
        ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE,
        "Athena email has no template store configured."
      );
    }
    let rows: readonly AthenaEmailTemplate[];
    try {
      rows = await store.listTemplates({
        ...selector,
        locale: undefined,
      });
    } catch (cause) {
      if (cause instanceof AthenaEmailError) {
        throw cause;
      }
      throw new AthenaEmailError(
        ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE,
        "The Athena email template store is unavailable.",
        { cause }
      );
    }
    return rows.filter(
      (row) =>
        (!selector.templateKey || row.templateKey === selector.templateKey) &&
        (!selector.eventType || row.eventType === selector.eventType)
    );
  }

  async function resolve(
    input: AthenaEmailTemplateSelector
  ): Promise<AthenaEmailTemplate> {
    assertSelector(input);
    const rows = await listTemplates(input);
    const active = rows.filter((row) => row.isActive !== false);
    const candidates = localeCandidates(input.locale ?? defaultLocale ?? "en");
    for (const locale of candidates) {
      const match = active.find(
        (row) => row.locale.trim().toLowerCase() === locale
      );
      if (match) {
        validateTemplate(match);
        return match;
      }
    }
    throw new AthenaEmailError(
      ATHENA_EMAIL_TEMPLATE_NOT_FOUND,
      `No active email template was found for ${selectorDescription(input)}.`
    );
  }

  return {
    assertAvailable: async (input) => {
      await resolve(input);
    },
    render: async (
      input: AthenaEmailTemplateRenderInput
    ): Promise<AthenaRenderedEmailTemplate> => {
      const template = await resolve(input);
      const variables = stringifyVariables(
        input.variables,
        templateVariables(template)
      );
      return {
        eventType: template.eventType,
        html:
          (template.html ?? template.htmlTemplate)
            ? interpolate(
                template.html ?? template.htmlTemplate ?? "",
                variables,
                true
              )
            : undefined,
        locale: template.locale,
        subject: interpolate(
          template.subject ?? template.subjectTemplate ?? "",
          variables,
          false
        ),
        template,
        templateId: template.id,
        templateKey: template.templateKey,
        text:
          (template.text ?? template.textTemplate)
            ? interpolate(
                template.text ?? template.textTemplate ?? "",
                variables,
                false
              )
            : undefined,
        variables,
      };
    },
    resolve,
    send: async (input) => {
      const rendered = await (async () => {
        const template = await resolve(input);
        const variables = stringifyVariables(
          input.variables,
          templateVariables(template)
        );
        return {
          rendered: {
            eventType: template.eventType,
            html:
              (template.html ?? template.htmlTemplate)
                ? interpolate(
                    template.html ?? template.htmlTemplate ?? "",
                    variables,
                    true
                  )
                : undefined,
            locale: template.locale,
            subject: interpolate(
              template.subject ?? template.subjectTemplate ?? "",
              variables,
              false
            ),
            template,
            templateId: template.id,
            templateKey: template.templateKey,
            text:
              (template.text ?? template.textTemplate)
                ? interpolate(
                    template.text ?? template.textTemplate ?? "",
                    variables,
                    false
                  )
                : undefined,
            variables,
          },
          template,
        };
      })();
      const result = await sendEmail({
        attachmentFailureMode:
          input.attachmentFailureMode ??
          rendered.template.attachmentFailureMode,
        attachments:
          input.attachments ??
          (rendered.template.attachments
            ? [...rendered.template.attachments]
            : undefined),
        bcc: input.bcc,
        cc: input.cc,
        from: input.from,
        fromName: input.fromName,
        headers: input.headers,
        html: rendered.rendered.html,
        locale: rendered.rendered.locale,
        metadata: {
          ...input.metadata,
          eventType: rendered.template.eventType,
          templateId: rendered.template.id,
          templateKey: rendered.template.templateKey,
        },
        replyTo: input.replyTo,
        subject: rendered.rendered.subject,
        text: rendered.rendered.text,
        to: input.to,
      });
      if (!result.success) {
        throw new AthenaEmailError(
          ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED,
          "The email template was rendered, but the provider did not accept delivery.",
          { cause: result }
        );
      }
      return result;
    },
  };
}

export function createAthenaEmailTemplates(
  store: TemplateStoreSource,
  sendEmail: SendEmail,
  defaultLocale?: string
): AthenaEmailTemplatesModule {
  return Object.freeze(createTemplateModule(store, sendEmail, defaultLocale));
}
