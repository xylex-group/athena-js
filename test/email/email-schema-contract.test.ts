import assert from "node:assert/strict";
import { test } from "node:test";

import { ATHENA_AUTH_TABLES } from "../../src/auth/contract/index.ts";
import { ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS } from "../../src/auth/local/email/schema-sql.ts";
import { PostgresAuthEmailStore } from "../../src/auth/local/email/postgres-store.ts";
import type { AthenaAuthDatabase } from "../../src/auth/local/database.ts";

test("embedded email schema reuses Rust athena.email_* table names", () => {
  assert.equal(ATHENA_AUTH_TABLES.emails, "athena.emails");
  assert.equal(ATHENA_AUTH_TABLES.emailSendFailures, "athena.email_send_failures");
  assert.equal(ATHENA_AUTH_TABLES.emailEventTypes, "athena.email_event_types");
  assert.equal(ATHENA_AUTH_TABLES.emailTemplates, "athena.email_templates");
});

test("embedded migrator applies Rust email generations 006 007 011 012 014 015", () => {
  const versions = ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS.map((statement) => statement.version);
  assert.deepEqual(versions, [6, 7, 11, 12, 14, 15]);
  const sql = ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS.map((statement) => statement.sql).join("\n");
  for (const fragment of [
    "athena.email_send_failures",
    "athena.emails",
    "athena.email_templates",
    "athena.email_event_types",
    "variable_bindings",
    "attachment_failure_mode",
    "subject_template",
    "UNIQUE (template_key, locale)",
    "user.email.verify",
    "organization.member.invite",
  ]) {
    assert.ok(sql.includes(fragment), `missing ${fragment}`);
  }
});

test("Postgres email store writes the Rust template column set", async () => {
  const statements: string[] = [];
  const db: AthenaAuthDatabase = {
    async query(text) {
      statements.push(text);
      return {
        rowCount: 1,
        rows: [
          {
            attachment_failure_mode: "fail",
            attachments: [],
            created_at: "2026-08-15T00:00:00.000Z",
            event_type: "user.password.reset",
            html_template: "<p>x</p>",
            id: "tmpl_1",
            is_active: true,
            locale: "en",
            metadata: {},
            subject_template: "Reset",
            template_key: "password_reset_email",
            text_template: "x",
            updated_at: "2026-08-15T00:00:00.000Z",
            variable_bindings: [],
            variables: [],
          },
        ],
      };
    },
    async transaction(fn) {
      return fn(db);
    },
  };
  const store = new PostgresAuthEmailStore(db);
  await store.createTemplate({
    attachment_failure_mode: "fail",
    attachments: [],
    created_at: "2026-08-15T00:00:00.000Z",
    event_type: "user.password.reset",
    html_template: "<p>x</p>",
    id: "tmpl_1",
    is_active: true,
    locale: "en",
    metadata: {},
    subject_template: "Reset",
    template_key: "password_reset_email",
    text_template: "x",
    updated_at: "2026-08-15T00:00:00.000Z",
    variable_bindings: [],
    variables: [],
  });
  assert.match(statements[0] ?? "", /INSERT INTO athena\.email_templates/);
  assert.match(statements[0] ?? "", /variable_bindings/);
  assert.match(statements[0] ?? "", /attachment_failure_mode/);
});
