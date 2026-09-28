/**
 * Sanitized domain DTOs for hooks, audit_log_auth, and future webhooks.
 * Explicit builders only — no generic recursive sanitization.
 */
export {
  type AthenaAuthHookInvitation as AthenaAuthInvitationPayload,
  type AthenaAuthHookMember as AthenaAuthMemberPayload,
  type AthenaAuthHookOrganization as AthenaAuthOrganizationPayload,
  type AthenaAuthHookUser as AthenaAuthUserPayload,
  sanitizeHookApiKey as sanitizeAuthApiKey,
  sanitizeHookInvitation as sanitizeAuthInvitation,
  sanitizeHookMember as sanitizeAuthMember,
  sanitizeHookOrganization as sanitizeAuthOrganization,
  sanitizeHookPasskey as sanitizeAuthPasskey,
  sanitizeHookSession as sanitizeAuthSession,
  sanitizeHookUser as sanitizeAuthUser,
} from "../hooks/sanitize.ts";
