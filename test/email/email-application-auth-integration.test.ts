import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmbeddedAuthEmailTemplateStore } from "../../src/auth/local/email/template-store.ts";
import { MemoryAuthStores } from "../../src/auth/local/memory-stores.ts";
import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import {
  bindAthenaEmailTemplateStore,
  createEmailModule,
} from "../../src/email/module.ts";

test("embedded Auth templates are available through email.templates", async () => {
  const runtime = createAthenaAuthRuntime({
    stores: new MemoryAuthStores(),
  });
  const authStore = runtime.getEmailStore();
  await authStore.createTemplate({
    attachment_failure_mode: "skip",
    attachments: [
      {
        file_url: "https://example.com/welcome.pdf",
        filename: "welcome.pdf",
      },
    ],
    created_at: new Date().toISOString(),
    event_type: "application.welcome",
    html_template: "<p>Hello {{name}}</p>",
    id: "welcome-en",
    is_active: true,
    locale: "en",
    subject_template: "Welcome {{name}}",
    template_key: "welcome",
    text_template: "Hello {{name}}",
    updated_at: new Date().toISOString(),
    variable_bindings: [],
    variables: ["name"],
  });

  const email = createEmailModule();
  bindAthenaEmailTemplateStore(
    email,
    createEmbeddedAuthEmailTemplateStore(runtime)
  );

  const rendered = await email.templates.render({
    templateKey: "welcome",
    variables: { name: "Ada" },
  });

  assert.equal(rendered.template.id, "welcome-en");
  assert.equal(rendered.subject, "Welcome Ada");
  assert.equal(rendered.html, "<p>Hello Ada</p>");
  assert.equal(rendered.text, "Hello Ada");
  assert.equal(rendered.template.attachmentFailureMode, "skip");
  assert.deepEqual(rendered.template.attachments, [
    {
      filename: "welcome.pdf",
      fileUrl: "https://example.com/welcome.pdf",
    },
  ]);
  await runtime.close();
});
