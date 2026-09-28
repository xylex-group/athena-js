/**
 * Server-neutral Athena Auth contract.
 *
 * Externally observable protocol shared by the Rust runtime
 * (`services/athena-auth`) and the TypeScript local runtime.
 *
 * HTTP operation SSOT: `AthenaAuthOperationDefinition` plus generated
 * `ATHENA_AUTH_OPERATIONS` (`scripts/auth-route-parity.mjs`).
 */

export type {
  AthenaAuthOperationAuth,
  AthenaAuthOperationCapability,
  AthenaAuthOperationDefinition,
  AthenaAuthRuntimeSupport,
} from "./operations.ts";
export {
  deriveEmbeddedCapabilityAdvertisement,
  listMissingEmbeddedOperations,
  operationKey,
  operationsForCapability,
} from "./operations.ts";

export const ATHENA_AUTH_PROTOCOL_VERSION = "1";

export const ATHENA_AUTH_DEFAULT_BASE_PATH = "/api/auth";

export const ATHENA_AUTH_TRACE_ID_HEADER = "x-athena-trace-id";
export const ATHENA_AUTH_REQUEST_ID_HEADER = "x-request-id";

/** Rust default session cookie name (`AuthConfig.session.cookie_name`). */
export const ATHENA_AUTH_SESSION_COOKIE_NAME = "athena-auth.session-token";

/** Additional cookie names accepted when reading a session. */
export const ATHENA_AUTH_SESSION_COOKIE_ALIASES = [
  "athena-auth.session_token",
  "athena-auth-session_token",
  "better-auth.session_token",
  "better-auth-session_token",
] as const;

export const ATHENA_AUTH_PASSWORD_HASH_KEY = "password_hash";

/** Credential account provider id used when a password row is also written. */
export const ATHENA_AUTH_CREDENTIAL_PROVIDER_ID = "credential";

/**
 * Current Athena Auth schema generation. The number is browser-safe; the SQL
 * catalog that must match it lives in `schema/migrations.ts` (Node / CLI).
 */
export { ATHENA_AUTH_SCHEMA_GENERATION } from "../schema/generation.ts";
export const ATHENA_AUTH_MIN_SUPPORTED_SCHEMA_GENERATION = 1;

export const ATHENA_AUTH_SCHEMA_NAME = "athena";

export const ATHENA_AUTH_TABLES = {
  accounts: "athena.accounts",
  apiKeys: "athena.api_keys",
  authBridgeCodes: "athena.auth_bridge_codes",
  authorizationAuditLog: "athena.authorization_audit_log",
  authorizationMemberRoles: "athena.authorization_member_roles",
  authorizationRevisions: "athena.authorization_revisions",
  authorizationRights: "athena.authorization_rights",
  authorizationRoleRights: "athena.authorization_role_rights",
  authorizationRoles: "athena.authorization_roles",
  authorizationUserRoles: "athena.authorization_user_roles",
  authSigningKeys: "athena.auth_signing_keys",
  emailEventTypes: "athena.email_event_types",
  emailSendFailures: "athena.email_send_failures",
  emails: "athena.emails",
  emailTemplates: "athena.email_templates",
  invitation: "athena.invitation",
  member: "athena.member",
  notificationPreferences: "athena.notification_preferences",
  oauthAuthorizationCodes: "athena.oauth_authorization_codes",
  oauthAuthorizationGrants: "athena.oauth_authorization_grants",
  oauthAuthorizationRequests: "athena.oauth_authorization_requests",
  oauthClients: "athena.oauth_clients",
  oauthRefreshTokens: "athena.oauth_refresh_tokens",
  oauthRevokedAccessTokens: "athena.oauth_revoked_access_tokens",
  oauthTransactions: "athena.oauth_transactions",
  organization: "athena.organization",
  passkeyRegistrationTransactions: "athena.passkey_registration_transactions",
  passkeys: "athena.passkeys",
  runtimeKey: "athena.runtime_key",
  schemaMigrations: "athena.auth_schema_migrations",
  sessions: "athena.sessions",
  twoFactor: "athena.two_factor",
  users: "athena.users",
  verifications: "athena.verifications",
} as const;

export const ATHENA_AUTH_CORE_ROUTES = {
  changePassword: { method: "POST", path: "/change-password" },
  deleteUser: { method: "POST", path: "/delete-user" },
  forgetPassword: { method: "POST", path: "/forget-password" },
  getSession: { methods: ["GET", "POST"] as const, path: "/get-session" },
  health: { method: "GET", path: "/health" },
  listAccounts: { method: "GET", path: "/list-accounts" },
  listSessions: { method: "GET", path: "/list-sessions" },
  ok: { method: "GET", path: "/ok" },
  organizationAcceptInvitation: {
    method: "POST",
    path: "/organization/accept-invitation",
  },
  organizationAddMember: {
    method: "POST",
    path: "/organization/add-member",
  },
  organizationCancelInvitation: {
    method: "POST",
    path: "/organization/cancel-invitation",
  },
  organizationCreate: { method: "POST", path: "/organization/create" },
  organizationDelete: { method: "POST", path: "/organization/delete" },
  organizationGet: {
    method: "GET",
    path: "/organization/get-full-organization",
  },
  organizationInviteMember: {
    method: "POST",
    path: "/organization/invite-member",
  },
  organizationInviteReminder: {
    method: "POST",
    path: "/organization/invite-member-reminder",
  },
  organizationLeave: { method: "POST", path: "/organization/leave" },
  organizationList: { method: "GET", path: "/organization/list" },
  organizationListInvitations: {
    method: "GET",
    path: "/organization/list-invitations",
  },
  organizationListMembers: {
    method: "GET",
    path: "/organization/list-members",
  },
  organizationRemoveMember: {
    method: "POST",
    path: "/organization/remove-member",
  },
  organizationSetActive: { method: "POST", path: "/organization/set-active" },
  organizationUpdate: { method: "POST", path: "/organization/update" },
  organizationUpdateMemberRole: {
    method: "POST",
    path: "/organization/update-member-role",
  },
  resetPassword: { method: "POST", path: "/reset-password" },
  revokeOtherSessions: { method: "POST", path: "/revoke-other-sessions" },
  revokeSession: { method: "POST", path: "/revoke-session" },
  revokeSessions: { method: "POST", path: "/revoke-sessions" },
  sendSecurityAlert: { method: "POST", path: "/send-security-alert" },
  sendSignInEmail: { method: "POST", path: "/send-sign-in-email" },
  signInEmail: { method: "POST", path: "/sign-in/email" },
  signInUsername: { method: "POST", path: "/sign-in/username" },
  signOut: { method: "POST", path: "/sign-out" },
  signUpEmail: { method: "POST", path: "/sign-up/email" },
  updateUser: { method: "POST", path: "/update-user" },
} as const;

export type AthenaAuthHttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export interface AthenaAuthErrorBody {
  code?: string;
  message: string;
  traceId: string;
  version: string;
}

export interface AthenaAuthContractUser {
  banExpires?: string | null;
  banned?: boolean;
  banReason?: string | null;
  createdAt: string;
  displayUsername?: string | null;
  email?: string | null;
  emailVerified: boolean;
  id: string;
  image?: string | null;
  lastSignInAt?: string | null;
  name?: string | null;
  role?: string | null;
  twoFactorEnabled?: boolean;
  updatedAt: string;
  username?: string | null;
}

export interface AthenaAuthContractSession {
  activeOrganizationId?: string | null;
  createdAt: string;
  expiresAt: string;
  id: string;
  impersonatedBy?: string | null;
  ipAddress?: string | null;
  token: string;
  updatedAt: string;
  userAgent?: string | null;
  userId: string;
}

export interface AthenaAuthArgon2Params {
  memoryCost: number;
  parallelism: number;
  timeCost: number;
}

/** Rust `Argon2Config::default()` — 1 MiB, 2 iterations, 1 lane, Argon2id v19. */
export const ATHENA_AUTH_DEFAULT_ARGON2: AthenaAuthArgon2Params = {
  memoryCost: 1024,
  parallelism: 1,
  timeCost: 2,
};

export const ATHENA_AUTH_DEFAULT_PASSWORD_MIN_LENGTH = 8;
export const ATHENA_AUTH_DEFAULT_PASSWORD_MAX_LENGTH = 128;
export const ATHENA_AUTH_DEFAULT_SESSION_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
export const ATHENA_AUTH_DEFAULT_SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;
export const ATHENA_AUTH_DEFAULT_BODY_LIMIT_BYTES = 1_048_576;
export const ATHENA_AUTH_RUNTIME_KEY_PURPOSE = "local-runtime";
/**
 * Session/transaction advisory lock for Embedded Auth DDL (keyring, migrate, repair).
 * Independent of application migrate locks (`ATHA`/`MIGS` in PostgresMigrationBackend).
 * The application lock does not serialize `AthenaAuthDatabase` connections.
 */
export const ATHENA_AUTH_INIT_ADVISORY_LOCK = 872_046_011;
/** Alias: Embedded Auth migrator lock. Same bigint as `ATHENA_AUTH_INIT_ADVISORY_LOCK`. */
export const ATHENA_AUTH_MIGRATION_ADVISORY_LOCK =
  ATHENA_AUTH_INIT_ADVISORY_LOCK;
/** JWT signing-key activation (paired with issuer hash). */
export const ATHENA_AUTH_SIGNING_KEY_ADVISORY_LOCK = 872_046_033;
