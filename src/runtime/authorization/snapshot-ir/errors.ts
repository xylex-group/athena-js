export class AthenaAuthorizationSnapshotIrValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AthenaAuthorizationSnapshotIrValidationError";
  }
}
