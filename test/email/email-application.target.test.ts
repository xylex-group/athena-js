import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED,
  ATHENA_EMAIL_TEMPLATE_NOT_FOUND,
  ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE,
  ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING,
  AthenaEmailError,
  bindAthenaEmailTemplateStore,
  createEmailModule,
} from "../../src/email/index.ts";

test("configured template stores take precedence over embedded Auth binding", async () => {
  const configuredStore = {
    async listTemplates() {
      return [
        {
          html: "<p>Configured</p>",
          locale: "en",
          subject: "Configured",
          templateKey: "welcome",
        },
      ];
    },
  };
  const embeddedStore = {
    async listTemplates() {
      return [
        {
          html: "<p>Embedded</p>",
          locale: "en",
          subject: "Embedded",
          templateKey: "welcome",
        },
      ];
    },
  };
  const email = createEmailModule({
    templates: { store: configuredStore },
  });

  bindAthenaEmailTemplateStore(email, embeddedStore);

  assert.equal(
    (await email.templates.resolve({ templateKey: "welcome" })).subject,
    "Configured"
  );
});

test("email config supplies a stable template module and store", async () => {
  const store = {
    async listTemplates() {
      return [
        {
          html: "<p>Hello</p>",
          id: "welcome-en",
          locale: "en",
          subject: "Welcome",
          templateKey: "welcome",
        },
      ];
    },
  };
  const email = createEmailModule({
    templates: { store },
  });

  const templates = email.templates;
  assert.strictEqual(templates, email.templates);
  assert.equal(
    (await templates.resolve({ templateKey: "welcome" })).id,
    "welcome-en"
  );
});

test("application templates fail instead of choosing an arbitrary locale", async () => {
  const email = createEmailModule(undefined, {
    templateStore: {
      async listTemplates() {
        return [
          {
            html: "<p>Hallo</p>",
            locale: "nl",
            subject: "Hallo",
            templateKey: "welcome",
          },
          {
            html: "<p>Bonjour</p>",
            locale: "fr",
            subject: "Bonjour",
            templateKey: "welcome",
          },
        ];
      },
    },
  });

  await assert.rejects(
    email.templates.resolve({ templateKey: "welcome" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_NOT_FOUND
  );
});

test("application templates normalize store failures into a typed error", async () => {
  const cause = new Error("database connection refused");
  const email = createEmailModule(undefined, {
    templateStore: {
      async listTemplates() {
        throw cause;
      },
    },
  });

  await assert.rejects(
    email.templates.resolve({ templateKey: "welcome" }),
    (error: unknown) =>
      error instanceof AthenaEmailError &&
      error.code === ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE &&
      error.cause === cause
  );
});

test("application templates allow omitted optional variables", async () => {
  const email = createEmailModule(undefined, {
    templateStore: {
      async listTemplates() {
        return [
          {
            html: "<p>Hello {{name}} from {{company_name}}</p>",
            locale: "en",
            subject: "Welcome {{name}}",
            templateKey: "welcome",
            variableBindings: [
              { name: "company_name", required: false },
              { name: "name", required: true },
            ],
          },
        ];
      },
    },
  });

  const rendered = await email.templates.render({
    templateKey: "welcome",
    variables: { name: "Ada" },
  });

  assert.equal(rendered.html, "<p>Hello Ada from </p>");
});

test("application templates reject blank required variables", async () => {
  const email = createEmailModule(undefined, {
    templateStore: {
      async listTemplates() {
        return [
          {
            html: "<p>Hello {{name}}</p>",
            locale: "en",
            subject: "Welcome {{name}}",
            templateKey: "welcome",
            variables: ["name"],
          },
        ];
      },
    },
  });

  await assert.rejects(
    email.templates.render({
      templateKey: "welcome",
      variables: { name: "  " },
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING
  );
});

test("application template attachments use stored values unless explicitly overridden", async () => {
  let delivered:
    | {
        attachmentFailureMode: string;
        attachments: unknown[];
      }
    | undefined;
  const email = createEmailModule(
    {
      provider: {
        id: "test",
        async send(message) {
          delivered = {
            attachmentFailureMode: message.attachmentFailureMode,
            attachments: message.attachments,
          };
          return {
            accepted: message.to,
            provider: "test",
            rejected: [],
            success: true,
          };
        },
      },
    },
    {
      templateStore: {
        async listTemplates() {
          return [
            {
              attachmentFailureMode: "skip" as const,
              attachments: [{ fileUrl: "https://example.com/invoice.pdf" }],
              html: "<p>Invoice</p>",
              locale: "en",
              subject: "Invoice",
              templateKey: "invoice",
            },
          ];
        },
      },
    }
  );

  await email.templates.send({
    from: "noreply@example.com",
    templateKey: "invoice",
    to: "ada@example.com",
  });
  assert.deepEqual(delivered, {
    attachmentFailureMode: "skip",
    attachments: [{ fileUrl: "https://example.com/invoice.pdf" }],
  });

  await email.templates.send({
    attachmentFailureMode: "fail",
    attachments: [{ content: "custom", filename: "custom.pdf" }],
    from: "noreply@example.com",
    templateKey: "invoice",
    to: "ada@example.com",
  });
  assert.deepEqual(delivered, {
    attachmentFailureMode: "fail",
    attachments: [{ content: "custom", filename: "custom.pdf" }],
  });
});

test("application templates resolve locale fallbacks and escape HTML values", async () => {
  const email = createEmailModule(
    {
      provider: {
        id: "test",
        async send(message) {
          return {
            accepted: message.to,
            provider: "test",
            rejected: [],
            success: true,
          };
        },
      },
    },
    {
      templateStore: {
        async listTemplates() {
          return [
            {
              eventType: "case.assigned",
              html: "<p>Hello {{assignee}}</p>",
              id: "case-assigned-nl",
              locale: "nl",
              subject: "Case assigned to {{assignee}}",
              templateKey: "case_assigned",
              text: "Hello {{assignee}}",
              variables: ["assignee"],
            },
          ];
        },
      },
    }
  );

  const rendered = await email.templates.render({
    eventType: "case.assigned",
    locale: "nl-NL",
    variables: { assignee: "<Ada & Co>" },
  });

  assert.equal(rendered.template.locale, "nl");
  assert.equal(rendered.subject, "Case assigned to <Ada & Co>");
  assert.equal(rendered.text, "Hello <Ada & Co>");
  assert.equal(rendered.html, "<p>Hello &lt;Ada &amp; Co&gt;</p>");

  await assert.rejects(
    email.templates.render({
      eventType: "case.assigned",
      locale: "nl-NL",
      variables: {},
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_VARIABLES_MISSING
  );
});

test("application templates send rendered messages through the low-level provider", async () => {
  let delivered: { html?: string; subject: string } | undefined;
  const email = createEmailModule(
    {
      provider: {
        id: "test",
        async send(message) {
          delivered = { html: message.html, subject: message.subject };
          return {
            accepted: message.to,
            provider: "test",
            rejected: [],
            success: true,
          };
        },
      },
    },
    {
      templateStore: {
        async listTemplates() {
          return [
            {
              eventType: "case.assigned",
              html: "<p>Hello {{assignee}}</p>",
              locale: "en",
              subject: "Case assigned to {{assignee}}",
              variables: ["assignee"],
            },
          ];
        },
      },
    }
  );

  const result = await email.templates.send({
    eventType: "case.assigned",
    from: "noreply@example.com",
    to: "ada@example.com",
    variables: { assignee: "<Ada>" },
  });

  assert.equal(result.success, true);
  assert.deepEqual(delivered, {
    html: "<p>Hello &lt;Ada&gt;</p>",
    subject: "Case assigned to <Ada>",
  });
});

test("application templates report missing templates with a typed error", async () => {
  const email = createEmailModule(undefined, {
    templateStore: {
      async listTemplates() {
        return [];
      },
    },
  });

  await assert.rejects(
    email.templates.resolve({ eventType: "case.missing" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_NOT_FOUND
  );
});

test("application templates fail clearly when no template store is available", async () => {
  const email = createEmailModule();

  await assert.rejects(
    email.templates.resolve({ eventType: "case.missing" }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_STORE_UNAVAILABLE
  );
});

test("application templates convert provider rejection into a typed error", async () => {
  const email = createEmailModule(
    {
      provider: {
        id: "test",
        async send(message) {
          return {
            accepted: [],
            from: message.from,
            provider: "test",
            rejected: message.to,
            success: false,
          };
        },
      },
    },
    {
      templateStore: {
        async listTemplates() {
          return [
            {
              eventType: "case.assigned",
              locale: "en",
              subject: "Case assigned",
              text: "Assigned",
            },
          ];
        },
      },
    }
  );

  await assert.rejects(
    email.templates.send({
      eventType: "case.assigned",
      from: "noreply@example.com",
      to: "ada@example.com",
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === ATHENA_EMAIL_TEMPLATE_DELIVERY_FAILED
  );
});
