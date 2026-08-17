export class AthenaAuthEmailError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AthenaAuthEmailError";
    this.status = status;
  }

  static badRequest(message: string): AthenaAuthEmailError {
    return new AthenaAuthEmailError(400, message);
  }
}
