/**
 * Internal engine/port errors. Not a public Auth error family.
 * Do not export from package root.
 */

export class AthenaPasskeyServerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "AthenaPasskeyServerError";
    this.code = code;
  }
}

export class AthenaPasskeyServerNotWiredError extends AthenaPasskeyServerError {
  constructor() {
    super(
      "ATHENA_PASSKEY_SERVER_NOT_WIRED",
      "embedded passkey server engine is not wired"
    );
  }
}
