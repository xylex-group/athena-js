import type { AthenaAuthEmailTemplateRow } from "./contract.ts";
import { AUTH_EMAIL_EVENT_CATALOG } from "./events.ts";

export interface BuiltinAuthEmailBody {
  html_template: string;
  subject_template: string;
  text_template: string;
}

/**
 * Must match `default_template_definition` in
 * `services/athena-auth/crates/core/src/email/templates.rs`.
 */
const BODIES: Record<string, BuiltinAuthEmailBody> = {
  account_deletion_confirmation_email: {
    html_template:
      '<p>Click the link below to confirm the deletion of your account:</p><p><a href="{{verification_url}}">Confirm Account Deletion</a></p><p>If you did not request this, please ignore this email.</p>',
    subject_template: "Confirm account deletion",
    text_template: "Confirm account deletion: {{verification_url}}",
  },
  change_email_confirmation_email: {
    html_template:
      '<p>Click the link below to confirm your new email address:</p><p><a href="{{verification_url}}">Confirm Email Change</a></p>',
    subject_template: "Confirm your email change",
    text_template: "Confirm your email change: {{verification_url}}",
  },
  magic_link_email: {
    html_template:
      '<p>Click the link below to sign in:</p><p><a href="{{sign_in_url}}">Sign in</a></p>',
    subject_template: "Sign in to {{app_name}}",
    text_template: "Sign in: {{sign_in_url}}",
  },
  organization_created_email: {
    html_template:
      "<p>Your organization <strong>{{organization_name}}</strong> is ready.</p>",
    subject_template: "{{organization_name}} is ready",
    text_template: "Your organization {{organization_name}} is ready.",
  },
  organization_invitation_email: {
    html_template:
      '<p>You were invited to join <strong>{{organization_name}}</strong>.</p><p>Role: <strong>{{role}}</strong></p><p>Invited by: <strong>{{inviter_identity}}</strong></p><p><a href="{{invitation_url}}">Open invitation</a></p><p>If you are not signed in yet, create or verify your account first, then open the invitation link again.</p>',
    subject_template: "Invitation to join {{organization_name}}",
    text_template:
      "You were invited to join {{organization_name}}.\nRole: {{role}}\nInvited by: {{inviter_identity}}\nInvitation link: {{invitation_url}}",
  },
  organization_invitation_reminder_email: {
    html_template:
      '<p>This is a reminder to join <strong>{{organization_name}}</strong>.</p><p><a href="{{invitation_url}}">Open invitation</a></p>',
    subject_template: "Reminder: join {{organization_name}}",
    text_template: "Reminder to join {{organization_name}}: {{invitation_url}}",
  },
  organization_invitation_revoked_email: {
    html_template:
      "<p>The invitation for <strong>{{invited_email}}</strong> to join <strong>{{organization_name}}</strong> was revoked.</p>",
    subject_template: "Invitation to {{organization_name}} was revoked",
    text_template:
      "The invitation for {{invited_email}} to join {{organization_name}} was revoked.",
  },
  organization_member_added_email: {
    html_template:
      "<p><strong>{{member_identity}}</strong> was added to <strong>{{organization_name}}</strong>.</p>",
    subject_template: "Added to {{organization_name}}",
    text_template: "{{member_identity}} was added to {{organization_name}}.",
  },
  organization_member_removed_email: {
    html_template:
      "<p><strong>{{member_identity}}</strong> was removed from <strong>{{organization_name}}</strong>.</p>",
    subject_template: "Removed from {{organization_name}}",
    text_template:
      "{{member_identity}} was removed from {{organization_name}}.",
  },
  organization_member_role_updated_email: {
    html_template:
      "<p><strong>{{member_identity}}</strong> is now <strong>{{new_role}}</strong> in <strong>{{organization_name}}</strong>.</p>",
    subject_template: "Role updated in {{organization_name}}",
    text_template:
      "{{member_identity}} is now {{new_role}} in {{organization_name}}.",
  },
  password_changed_email: {
    html_template:
      "<p>Your password was changed. If you did not do this, secure your account immediately.</p>",
    subject_template: "Your password was changed",
    text_template:
      "Your password was changed. If you did not do this, secure your account immediately.",
  },
  password_reset_email: {
    html_template:
      '<p>Click the link below to reset your password:</p><p><a href="{{reset_url}}">Reset Password</a></p>',
    subject_template: "Reset your password",
    text_template: "Reset your password: {{reset_url}}",
  },
  security_alert_email: {
    html_template:
      "<p><strong>{{alert_title}}</strong></p><p>{{alert_details}}</p>",
    subject_template: "Security alert: {{alert_title}}",
    text_template: "{{alert_title}}\n{{alert_details}}",
  },
  two_factor_otp_email: {
    html_template:
      "<p>Your 2FA verification code is: <strong>{{otp_code}}</strong></p>",
    subject_template: "Your verification code",
    text_template: "Your 2FA verification code is: {{otp_code}}",
  },
  verification_email: {
    html_template:
      '<p>Click the link below to verify your email address:</p><p><a href="{{verification_url}}">Verify Email</a></p>',
    subject_template: "Verify your email address",
    text_template: "Verify your email address: {{verification_url}}",
  },
  welcome_email: {
    html_template: "<p>Hi {{user_name}},</p><p>Your account is ready.</p>",
    subject_template: "Welcome to {{app_name}}",
    text_template: "Hi {{user_name}}, your account is ready.",
  },
};

export function builtinAuthEmailBody(
  templateKey: string | null | undefined
): BuiltinAuthEmailBody | undefined {
  if (!templateKey) {
    return;
  }
  return BODIES[templateKey];
}

export function builtinTemplateRow(
  eventType: string,
  locale: string
): AthenaAuthEmailTemplateRow | undefined {
  const definition = AUTH_EMAIL_EVENT_CATALOG.find(
    (entry) => entry.event_type === eventType
  );
  const key = definition?.default_template_key;
  const body = builtinAuthEmailBody(key);
  if (!(definition && key && body)) {
    return;
  }
  const stamp = new Date(0).toISOString();
  return {
    attachment_failure_mode: "fail",
    attachments: [],
    created_at: stamp,
    event_type: eventType,
    html_template: body.html_template,
    id: `builtin:${key}:${locale}`,
    is_active: true,
    locale,
    metadata: { builtin: true },
    subject_template: body.subject_template,
    template_key: key,
    text_template: body.text_template,
    updated_at: stamp,
    variable_bindings: [],
    variables: [...definition.required_variables],
  };
}
