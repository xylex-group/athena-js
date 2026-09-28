export type AthenaRightKeyErrorCode =
  | "RIGHT_KEY_EMPTY"
  | "RIGHT_KEY_INVALID_CHARACTERS"
  | "RIGHT_KEY_EMPTY_SEGMENT"
  | "RIGHT_KEY_MALFORMED_PATTERN";

export class AthenaRightKeyError extends Error {
  readonly code: AthenaRightKeyErrorCode;
  readonly key?: string;

  constructor(code: AthenaRightKeyErrorCode, message: string, key?: string) {
    super(message);
    this.name = "AthenaRightKeyError";
    this.code = code;
    if (key !== undefined) {
      this.key = key;
    }
  }
}
