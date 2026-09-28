import { AUTH_EMAIL_EVENT_CATALOG } from "../../email/events.ts";

/**
 * Frozen 014 seed. Released migration 014 permanently inserted the ten later
 * events with `default_template_key = NULL`. Do not regenerate this from the
 * live catalog — 024 is the forward fix.
 */
const AUTH_EMAIL_EVENT_CATALOG_V014: ReadonlyArray<{
  category: string;
  default_template_key: string | null;
  description: string;
  event_type: string;
  optional_variables: readonly string[];
  required_variables: readonly string[];
}> = AUTH_EMAIL_EVENT_CATALOG.map((entry) => {
  const futureKeys: Record<string, null> = {
    "organization.create": null,
    "organization.member.added": null,
    "organization.member.invite.reminder": null,
    "organization.member.invite.revoked": null,
    "organization.member.removed": null,
    "organization.member.role.updated": null,
    "user.password.changed": null,
    "user.security.alert": null,
    "user.sign-in.email": null,
    "user.sign-up.welcome": null,
  };
  return {
    category: entry.category,
    default_template_key:
      entry.event_type in futureKeys ? null : entry.default_template_key,
    description: entry.description,
    event_type: entry.event_type,
    optional_variables: entry.optional_variables,
    required_variables: entry.required_variables,
  };
});

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
${emailEventTypeSeedSql(AUTH_EMAIL_EVENT_CATALOG_V014)}
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
  {
    name: "024_email_event_default_templates",
    sql: `
INSERT INTO athena.email_event_types (
    event_type, category, description, default_template_key,
    required_variables, optional_variables, is_active, is_system, metadata
)
VALUES
    (
        'user.sign-in.email',
        'user_security',
        'Email-based sign-in link or magic-link authentication flow.',
        'magic_link_email',
        '["sign_in_url"]'::jsonb,
        '["app_name"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"auth"}'::jsonb
    ),
    (
        'user.sign-up.welcome',
        'user_lifecycle',
        'Welcome message after account creation.',
        'welcome_email',
        '["user_name"]'::jsonb,
        '["app_name","dashboard_url"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"auth"}'::jsonb
    ),
    (
        'user.password.changed',
        'user_security',
        'Security notification after password change completes.',
        'password_changed_email',
        '[]'::jsonb,
        '["app_name","support_url"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"auth"}'::jsonb
    ),
    (
        'user.security.alert',
        'user_security',
        'General security alert notification (suspicious sign-in, new device, policy event).',
        'security_alert_email',
        '["alert_title","alert_details"]'::jsonb,
        '["app_name","support_url"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"auth"}'::jsonb
    ),
    (
        'organization.create',
        'organization_lifecycle',
        'Organization creation confirmation and onboarding.',
        'organization_created_email',
        '["organization_name"]'::jsonb,
        '["app_name","organization_url"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    ),
    (
        'organization.member.added',
        'organization_lifecycle',
        'Notify when a member is added without invite flow.',
        'organization_member_added_email',
        '["organization_name","member_identity"]'::jsonb,
        '["app_name","actor_identity"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    ),
    (
        'organization.member.removed',
        'organization_lifecycle',
        'Notify when a member is removed from an organization.',
        'organization_member_removed_email',
        '["organization_name","member_identity"]'::jsonb,
        '["app_name","actor_identity"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    ),
    (
        'organization.member.role.updated',
        'organization_lifecycle',
        'Notify when organization member role is changed.',
        'organization_member_role_updated_email',
        '["organization_name","member_identity","new_role"]'::jsonb,
        '["app_name","previous_role","actor_identity"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    ),
    (
        'organization.member.invite.reminder',
        'organization_lifecycle',
        'Reminder message for pending organization invitations.',
        'organization_invitation_reminder_email',
        '["organization_name","invitation_url"]'::jsonb,
        '["app_name","role","inviter_identity"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    ),
    (
        'organization.member.invite.revoked',
        'organization_lifecycle',
        'Notification that an invitation has been revoked.',
        'organization_invitation_revoked_email',
        '["organization_name","invited_email"]'::jsonb,
        '["app_name","inviter_identity"]'::jsonb,
        TRUE,
        TRUE,
        '{"scope":"organization"}'::jsonb
    )
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
UPDATE athena.email_templates AS t
SET event_type = m.event_type
FROM (
    VALUES
        ('magic_link_email', 'user.sign-in.email'),
        ('welcome_email', 'user.sign-up.welcome'),
        ('password_changed_email', 'user.password.changed'),
        ('security_alert_email', 'user.security.alert'),
        ('organization_created_email', 'organization.create'),
        ('organization_member_added_email', 'organization.member.added'),
        ('organization_member_removed_email', 'organization.member.removed'),
        ('organization_member_role_updated_email', 'organization.member.role.updated'),
        ('organization_invitation_reminder_email', 'organization.member.invite.reminder'),
        ('organization_invitation_revoked_email', 'organization.member.invite.revoked')
) AS m(template_key, event_type)
WHERE t.template_key = m.template_key
  AND (t.event_type IS NULL OR t.event_type IS DISTINCT FROM m.event_type);
`,
    version: 24,
  },
];

function sqlLiteral(value: string | null): string {
  if (value === null) {
    return "NULL";
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function emailEventTypeSeedSql(
  catalog: ReadonlyArray<{
    category: string;
    default_template_key: string | null;
    description: string;
    event_type: string;
    optional_variables: readonly string[];
    required_variables: readonly string[];
  }> = AUTH_EMAIL_EVENT_CATALOG
): string {
  const values = catalog
    .map(
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
    )
    .join(",\n    ");
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
