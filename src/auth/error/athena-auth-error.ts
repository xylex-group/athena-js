/**
 * Athena Auth SDK error for configuration and invariant failures in
 * OAuth / social-provider flows.
 */
export class AthenaAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown | undefined }) {
    super(message, options);
    this.name = "AthenaAuthError";
    this.message = message;
    this.stack = "";
  }
}

/** @deprecated Use {@link AthenaAuthError}. */
export const BetterAuthError = AthenaAuthError;
