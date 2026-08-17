import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { toSessionData } from "../src/auth/session-data.ts";
import {
  AthenaUnauthenticatedError,
  isAbortError,
  toAthenaSessionError,
} from "../src/auth/session-errors.ts";
import { deriveSessionView } from "../src/auth/session-view.ts";

const transport = {
  session: { activeOrganizationId: "org_raw", id: "s1" },
  user: { email: "a@b.c", id: "u1" },
};

test("toSessionData freezes snapshot and maps org ids", () => {
  const data = toSessionData(transport, { activeId: "org_fixed" });
  assert.equal(data.organization.activeId, "org_fixed");
  assert.equal(data.organization.rawActiveId, "org_raw");
  assert.throws(() => {
    (data as { user: { id: string } }).user = { id: "x", email: "" } as never;
  });
  assert.throws(() => {
    (data.user as { name?: string }).name = "mutated";
  });
});

test("deriveSessionView browser path keeps active===raw", () => {
  const view = deriveSessionView(transport);
  assert.equal(view.isAuthenticated, true);
  assert.equal(view.organizationId, "org_raw");
  assert.equal(view.organization?.activeId, view.organization?.rawActiveId);
});

test("toAthenaSessionError maps kinds", () => {
  const err = toAthenaSessionError("unauthenticated");
  assert.ok(err instanceof AthenaUnauthenticatedError);
  assert.equal(err.code, "ATHENA_SESSION_UNAUTHENTICATED");
});

test("isAbortError detects AbortError name", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(isAbortError(abort), true);
  assert.equal(isAbortError(new Error("x")), false);
});


test("toSessionData freezes session fields", () => {
  const data = toSessionData(transport);
  assert.throws(() => {
    (data.session as { activeOrganizationId?: string | null }).activeOrganizationId =
      "mutated";
  });
});

test("toAthenaSessionError maps all kinds", () => {
  assert.equal(toAthenaSessionError("upstream").name, "AthenaAuthUpstreamError");
  assert.equal(
    toAthenaSessionError("configuration").name,
    "AthenaAuthConfigurationError"
  );
  assert.equal(toAthenaSessionError("protocol").name, "AthenaAuthProtocolError");
  assert.equal(
    toAthenaSessionError("no_organization").name,
    "AthenaSessionOrganizationError"
  );
});

test("isAbortError detects TimeoutError", () => {
  const t = new Error("timeout");
  t.name = "TimeoutError";
  assert.equal(isAbortError(t), true);
});

