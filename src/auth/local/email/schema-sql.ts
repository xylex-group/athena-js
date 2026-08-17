import { AUTH_EMAIL_EVENT_CATALOG } from "../../email/events.ts";

/**
 * Rust Athena Auth email tables (`services/athena-auth` migrations 006, 007,
 * 011, 012, 014, 015 + runtime ensure-schema). Same names and columns so a
 * shared Postgres is mutually readable.
 */
export const ATHENA_AUTH_EMAIL_SCHEMA_STATEMENTS: ReadonlyArray<{
  name: string;
  sql: string;
  version: number;
}> = [
  {
    name: "006_create_email_send_failures_table",
    sql: `
CREATE TABLE IF NOT EXISTS athena.email_send_failures (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    recipient_email TEXT NOT NULL,
    flow TEXT NOT NULL,
    provider TEXT,
    error_message TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_send_failures_created_at
    ON athena.email_send_failures (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_send_failures_recipient_email
    ON athena.email_send_failures (recipient_email);
`,
    version: 6,
  },
  {
    name: "007_create_emails_table",
    sql: `
CREATE TABLE IF NOT EXISTS athena.emails (
    id TEXT PRIMARY KEY,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    from_address TEXT NOT NULL,
    from_name TEXT,
    text_body TEXT,
    html_body TEXT,
    provider TEXT NOT NULL,
    flow TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_emails_created_at ON athena.emails (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_recipient_email ON athena.emails (recipient_email);
`,
    version: 7,
  },
  {
    name: "011_create_email_templates_table",
    sql: `
CREATE TABLE IF NOT EXISTS athena.email_templates (
    id TEXT PRIMARY KEY,
    template_key TEXT NOT NULL,
    locale TEXT NOT NULL DEFAULT 'en',
    subject_template TEXT NOT NULL,
    text_template TEXT,
    html_template TEXT,
    variables JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (template_key, locale)
);
CREATE INDEX IF NOT EXISTS idx_email_templates_template_key ON athena.email_templates (template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_is_active ON athena.email_templates (is_active);
`,
    version: 11,
  },
  {
    name: "012_email_multitenancy_admin_ops",
    sql: `
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS resolved BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS resolution_note TEXT;
ALTER TABLE athena.email_send_failures
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_email_send_failures_resolved
    ON athena.email_send_failures (resolved);
CREATE INDEX IF NOT EXISTS idx_email_send_failures_flow
    ON athena.email_send_failures (flow);
ALTER TABLE athena.emails ADD COLUMN IF NOT EXISTS flow TEXT;
ALTER TABLE athena.emails ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_emails_provider ON athena.emails (provider);
CREATE INDEX IF NOT EXISTS idx_emails_flow ON athena.emails (flow);
`,
    version: 12,
  },
  {
    name: "014_email_event_types_and_template_assignment",
    sql: `
CREATE TABLE IF NOT EXISTS athena.email_event_types (
    event_type TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    default_template_key TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_system BOOLEAN NOT NULL DEFAULT TRUE,
    required_variables JSONB NOT NULL DEFAULT '[]',
    optional_variables JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE athena.email_templates ADD COLUMN IF NOT EXISTS event_type TEXT;
CREATE INDEX IF NOT EXISTS idx_email_event_types_category ON athena.email_event_types (category);
CREATE INDEX IF NOT EXISTS idx_email_event_types_is_active ON athena.email_event_types (is_active);
CREATE INDEX IF NOT EXISTS idx_email_templates_event_type ON athena.email_templates (event_type);
CREATE INDEX IF NOT EXISTS idx_email_templates_event_type_locale_active
    ON athena.email_templates (event_type, locale, is_active);
${emailEventTypeSeedSql()}
`,
    version: 14,
  },
  {
    name: "015_email_template_attachments",
    sql: `
ALTER TABLE athena.email_templates
    ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]';
ALTER TABLE athena.email_templates
    ADD COLUMN IF NOT EXISTS attachment_failure_mode TEXT NOT NULL DEFAULT 'fail';
ALTER TABLE athena.email_templates
    ADD COLUMN IF NOT EXISTS variable_bindings JSONB NOT NULL DEFAULT '[]';
`,
    version: 15,
  },
];

function sqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function emailEventTypeSeedSql(): string {
  const values = AUTH_EMAIL_EVENT_CATALOG.map(
    (entry) => `(
        ${sqlLiteral(entry.event_type)},
        ${sqlLiteral(entry.category)},
        ${sqlLiteral(entry.description)},
        ${sqlLiteral(entry.default_template_key)},
        '${JSON.stringify(entry.required_variables)}'::jsonb,
        '${JSON.stringify(entry.optional_variables)}'::jsonb,
        TRUE,
        TRUE,
        '{}'::jsonb
    )`
  ).join(",\n    ");
  return `
INSERT INTO athena.email_event_types (
    event_type, category, description, default_template_key,
    required_variables, optional_variables, is_active, is_system, metadata
)
VALUES
    ${values}
ON CONFLICT (event_type) DO UPDATE
SET
    category = EXCLUDED.category,
    description = EXCLUDED.description,
    default_template_key = EXCLUDED.default_template_key,
    required_variables = EXCLUDED.required_variables,
    optional_variables = EXCLUDED.optional_variables,
    is_active = EXCLUDED.is_active,
    is_system = EXCLUDED.is_system,
    metadata = EXCLUDED.metadata,
    updated_at = NOW();
`;
}
