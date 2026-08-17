export const authEmailEvents = {
  organization: {
    created: "organization.create",
    member: {
      added: "organization.member.added",
      invite: "organization.member.invite",
      inviteReminder: "organization.member.invite.reminder",
      inviteRevoked: "organization.member.invite.revoked",
      removed: "organization.member.removed",
      roleUpdated: "organization.member.role.updated",
    },
  },
  user: {
    account: {
      deletionConfirmation: "user.account.delete.confirmation",
    },
    email: {
      changeConfirmation: "user.email.change.confirmation",
      verify: "user.email.verify",
    },
    password: {
      changed: "user.password.changed",
      reset: "user.password.reset",
    },
    security: {
      alert: "user.security.alert",
    },
    signIn: {
      email: "user.sign-in.email",
      otp: "user.sign-in.otp",
    },
    signUp: {
      welcome: "user.sign-up.welcome",
    },
  },
} as const;

export type AuthEmailEventNested = typeof authEmailEvents;

export interface AthenaAuthEmailEventDefinition {
  category: string;
  default_template_key: string | null;
  description: string;
  event_type: string;
  is_active: boolean;
  is_system: boolean;
  optional_variables: readonly string[];
  required_variables: readonly string[];
}

export const AUTH_EMAIL_EVENT_CATALOG: readonly AthenaAuthEmailEventDefinition[] =
  [
    {
      category: "user_lifecycle",
      default_template_key: "verification_email",
      description:
        "Verify a user email address after signup or manual verification resend.",
      event_type: authEmailEvents.user.email.verify,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["verification_url"],
    },
    {
      category: "user_security",
      default_template_key: "password_reset_email",
      description: "Send a password reset link.",
      event_type: authEmailEvents.user.password.reset,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["reset_url"],
    },
    {
      category: "user_security",
      default_template_key: "change_email_confirmation_email",
      description: "Confirm a pending user email address change.",
      event_type: authEmailEvents.user.email.changeConfirmation,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["verification_url"],
    },
    {
      category: "user_security",
      default_template_key: "account_deletion_confirmation_email",
      description: "Confirm account deletion before destructive delete.",
      event_type: authEmailEvents.user.account.deletionConfirmation,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["verification_url"],
    },
    {
      category: "user_security",
      default_template_key: "two_factor_otp_email",
      description: "Deliver one-time passcode for two-factor authentication.",
      event_type: authEmailEvents.user.signIn.otp,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["otp_code"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: "organization_invitation_email",
      description: "Invite a member to join an organization.",
      event_type: authEmailEvents.organization.member.invite,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: [
        "organization_name",
        "role",
        "inviter_identity",
        "invitation_url",
      ],
    },
    {
      category: "user_security",
      default_template_key: null,
      description: "Email-based sign-in link or magic-link authentication flow.",
      event_type: authEmailEvents.user.signIn.email,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name"],
      required_variables: ["sign_in_url"],
    },
    {
      category: "user_lifecycle",
      default_template_key: null,
      description: "Welcome message after account creation.",
      event_type: authEmailEvents.user.signUp.welcome,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "dashboard_url"],
      required_variables: ["user_name"],
    },
    {
      category: "user_security",
      default_template_key: null,
      description: "Security notification after password change completes.",
      event_type: authEmailEvents.user.password.changed,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "support_url"],
      required_variables: [],
    },
    {
      category: "user_security",
      default_template_key: null,
      description:
        "General security alert notification (suspicious sign-in, new device, policy event).",
      event_type: authEmailEvents.user.security.alert,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "support_url"],
      required_variables: ["alert_title", "alert_details"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Organization creation confirmation and onboarding.",
      event_type: authEmailEvents.organization.created,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "organization_url"],
      required_variables: ["organization_name"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Notify when a member is added without invite flow.",
      event_type: authEmailEvents.organization.member.added,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "actor_identity"],
      required_variables: ["organization_name", "member_identity"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Notify when a member is removed from an organization.",
      event_type: authEmailEvents.organization.member.removed,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "actor_identity"],
      required_variables: ["organization_name", "member_identity"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Notify when organization member role is changed.",
      event_type: authEmailEvents.organization.member.roleUpdated,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "previous_role", "actor_identity"],
      required_variables: ["organization_name", "member_identity", "new_role"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Reminder message for pending organization invitations.",
      event_type: authEmailEvents.organization.member.inviteReminder,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "role", "inviter_identity"],
      required_variables: ["organization_name", "invitation_url"],
    },
    {
      category: "organization_lifecycle",
      default_template_key: null,
      description: "Notification that an invitation has been revoked.",
      event_type: authEmailEvents.organization.member.inviteRevoked,
      is_active: true,
      is_system: true,
      optional_variables: ["app_name", "inviter_identity"],
      required_variables: ["organization_name", "invited_email"],
    },
  ];

export function flattenAuthEmailEvents(
  tree: unknown,
  acc: string[] = []
): string[] {
  if (typeof tree === "string") {
    acc.push(tree);
    return acc;
  }
  if (tree && typeof tree === "object") {
    for (const value of Object.values(tree)) {
      flattenAuthEmailEvents(value, acc);
    }
  }
  return acc;
}

export function getAuthEmailEventDefinition(
  eventType: string | null | undefined
): AthenaAuthEmailEventDefinition | undefined {
  if (!eventType) {
    return undefined;
  }
  return AUTH_EMAIL_EVENT_CATALOG.find((entry) => entry.event_type === eventType);
}
