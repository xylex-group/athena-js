import type { AthenaPasskeyAuditEvent } from "./types.ts";

/** Audit sink port. No second audit core. */
export interface PasskeyAuditSink {
  record(event: AthenaPasskeyAuditEvent): void | Promise<void>;
}
