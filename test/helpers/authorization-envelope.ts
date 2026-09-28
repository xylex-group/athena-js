import { strict as assert } from "node:assert/strict";

export function assertMissingRightsEnvelope(error: {
  code?: string;
  errorNumber?: number;
  message?: string;
  missing?: readonly string[];
  operation?: string;
}): void {
  assert.ok(typeof error.code === "string" && error.code.length > 0);
  assert.ok(typeof error.errorNumber === "number");
  assert.ok(typeof error.message === "string" && error.message.length > 0);
  assert.ok(typeof error.operation === "string" && error.operation.length > 0);
  assert.ok(Array.isArray(error.missing) && error.missing.length > 0);
  assert.ok(error.missing.every((entry) => typeof entry === "string"));
}
