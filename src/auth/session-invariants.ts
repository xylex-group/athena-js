/**
 * Named Athena Auth session invariants (SESSION-INV-*).
 * Tests and the controller must cite these IDs on failure.
 */

export const SESSION_INVARIANTS = {
  /** Only one active refresh transport operation per client/session scope. */
  "SESSION-INV-01": "single-flight refresh",
  /** A stale refresh cannot overwrite a newer authoritative sign-in. */
  "SESSION-INV-02": "sign-in beats stale refresh",
  /** A stale refresh cannot resurrect a signed-out session. */
  "SESSION-INV-03": "sign-out beats stale refresh",
  /** A stale refresh cannot resurrect a revoked session. */
  "SESSION-INV-04": "revoke beats stale refresh",
  /** A transport error does not automatically destroy a still-valid session. */
  "SESSION-INV-05": "transient error preserves valid session",
  /** A definitive authentication-invalid response does clear the canonical session. */
  "SESSION-INV-06": "invalid session clears state",
  /** Subscriber notification ordering is monotonic. */
  "SESSION-INV-07": "monotonic subscriber notifications",
  /** Separate root clients do not share browser session state accidentally. */
  "SESSION-INV-08": "separate clients stay isolated",
  /** Request-scoped server users never share a process-global authenticated identity. */
  "SESSION-INV-09": "request-scoped views do not leak users",
} as const;

export type SessionInvariantId = keyof typeof SESSION_INVARIANTS;

export function sessionInvariantMessage(
  id: SessionInvariantId,
  detail?: string
): string {
  const title = SESSION_INVARIANTS[id];
  return detail ? `${id} (${title}): ${detail}` : `${id} (${title})`;
}
