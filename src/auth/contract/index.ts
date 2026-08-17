/**
 * Server-neutral Athena Auth contract.
 *
 * Externally observable protocol shared by the Rust runtime
 * (`services/athena-auth`) and the TypeScript local runtime.
 */

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
 * Current Athena Auth schema generation understood by both runtimes.
 * Rust migrations 001–020 plus the shared runtime key + ledger tables.
 */
export const ATHENA_AUTH_SCHEMA_GENERATION = 21;
export const ATHENA_AUTH_MIN_SUPPORTED_SCHEMA_GENERATION = 1;

export const ATHENA_AUTH_SCHEMA_NAME = "athena";

export const ATHENA_AUTH_TABLES = {
  users: "athena.users",
  sessions: "athena.sessions",
  accounts: "athena.accounts",
  verifications: "athena.verifications",
  organization: "athena.organization",
  member: "athena.member",
  invitation: "athena.invitation",
  twoFactor: "athena.two_factor",
  apiKeys: "athena.api_keys",
  passkeys: "athena.passkeys",
  emails: "athena.emails",
  emailSendFailures: "athena.email_send_failures",
  emailEventTypes: "athena.email_event_types",
  emailTemplates: "athena.email_templates",
  runtimeKey: "athena.runtime_key",
  schemaMigrations: "athena.auth_schema_migrations",
} as const;

export const ATHENA_AUTH_CORE_ROUTES = {
  ok: { method: "GET", path: "/ok" },
  health: { method: "GET", path: "/health" },
  getSession: { methods: ["GET", "POST"] as const, path: "/get-session" },
  signUpEmail: { method: "POST", path: "/sign-up/email" },
  signInEmail: { method: "POST", path: "/sign-in/email" },
  signInUsername: { method: "POST", path: "/sign-in/username" },
  signOut: { method: "POST", path: "/sign-out" },
  forgetPassword: { method: "POST", path: "/forget-password" },
  resetPassword: { method: "POST", path: "/reset-password" },
  changePassword: { method: "POST", path: "/change-password" },
  updateUser: { method: "POST", path: "/update-user" },
  deleteUser: { method: "POST", path: "/delete-user" },
  listSessions: { method: "GET", path: "/list-sessions" },
  revokeSession: { method: "POST", path: "/revoke-session" },
  revokeSessions: { method: "POST", path: "/revoke-sessions" },
  revokeOtherSessions: { method: "POST", path: "/revoke-other-sessions" },
  listAccounts: { method: "GET", path: "/list-accounts" },
  organizationCreate: { method: "POST", path: "/organization/create" },
  organizationList: { method: "GET", path: "/organization/list" },
  organizationGet: { method: "GET", path: "/organization/get-full-organization" },
  organizationUpdate: { method: "POST", path: "/organization/update" },
  organizationDelete: { method: "POST", path: "/organization/delete" },
  organizationSetActive: { method: "POST", path: "/organization/set-active" },
  organizationListMembers: { method: "GET", path: "/organization/list-members" },
  organizationRemoveMember: { method: "POST", path: "/organization/remove-member" },
  organizationUpdateMemberRole: {
    method: "POST",
    path: "/organization/update-member-role",
  },
  organizationLeave: { method: "POST", path: "/organization/leave" },
  organizationInviteMember: { method: "POST", path: "/organization/invite-member" },
  organizationAcceptInvitation: {
    method: "POST",
    path: "/organization/accept-invitation",
  },
  organizationCancelInvitation: {
    method: "POST",
    path: "/organization/cancel-invitation",
  },
  organizationListInvitations: {
    method: "GET",
    path: "/organization/list-invitations",
  },
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
export const ATHENA_AUTH_INIT_ADVISORY_LOCK = 872_046_011;
