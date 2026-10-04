import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthorizationModule } from "../src/auth/authorization/client-module.ts";
import type {
  AthenaAuthCallOptions,
  AthenaAuthRequestInput,
  AthenaAuthResult,
} from "../src/auth/types.ts";

test("typed authority snapshot binding sends an explicit organization scope", async () => {
  let captured: AthenaAuthRequestInput | undefined;
  const request = async <T>(
    input: AthenaAuthRequestInput,
    _options?: AthenaAuthCallOptions
  ): Promise<AthenaAuthResult<T>> => {
    captured = input;
    return { data: {} as T, error: null, ok: true, raw: null, status: 200 };
  };
  const authorization = createAuthorizationModule(request);

  await authorization.getAuthoritySnapshot({
    organizationId: "org-1",
    scope: "organization",
  });

  assert.equal(captured?.endpoint, "/authorization/authority-snapshot");
  assert.equal(captured?.method, "GET");
  assert.deepEqual(captured?.query, {
    organizationId: "org-1",
    scope: "organization",
  });
});
