/**
 * Athena Auth OAuth principal façade for application-owned MCP / BFF bindings.
 *
 * @see createAthenaOAuthPrincipalResolver
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AthenaOAuthAuthorizationServerRequiredError,
  createAthenaOAuthPrincipalResolver,
} from "../../src/auth/oauth-principal-resolver.ts";

test("createAthenaOAuthPrincipalResolver requires a root client with OAuth runtime", async () => {
  await assert.rejects(
    () =>
      createAthenaOAuthPrincipalResolver({
        client: {},
        resource: "https://app.example/api/athena/mcp",
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      // Either ownership mismatch or missing OAuth runtime — both fail closed.
      return (
        error instanceof AthenaOAuthAuthorizationServerRequiredError ||
        /requires the process-wide Athena root|OAuth authorization server/i.test(
          error.message
        )
      );
    }
  );
});
