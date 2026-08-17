/**
 * Client-side mirrors of the Athena authorization spine.
 *
 * Athena Auth UI and app code consume these types for display and request
 * shaping. They are not a security boundary — only a server
 * `AuthorizationDecision` Allow authorizes a protected operation.
 */

export type PrincipalKind =
  | "anonymous"
  | "user"
  | "service"
  | "api_key"
  | "system"
  | "break_glass";

export type DecisionOutcome = "allow" | "deny";

export type PublicAuthorizationMessage =
  | "authorized"
  | "insufficient rights"
  | "not found"
  | "unauthorized";

export type DecisionReasonKind =
  | "effective_right_matched"
  | "policy_allow"
  | "missing_right"
  | "policy_deny"
  | "scope_mismatch"
  | "untrusted_claim";

/** Map an internal reason to the caller-safe public message. */
export function publicAuthorizationMessage(
  reason: DecisionReasonKind,
): PublicAuthorizationMessage {
  switch (reason) {
    case "effective_right_matched":
    case "policy_allow":
      return "authorized";
    case "missing_right":
    case "policy_deny":
      return "insufficient rights";
    case "scope_mismatch":
      return "not found";
    case "untrusted_claim":
      return "unauthorized";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}
