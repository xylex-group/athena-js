import assert from "node:assert/strict";
import { test } from "node:test";

import { createAthenaAuthRuntime } from "../../src/auth/local/runtime.ts";
import { passwordHashNeedsRehash } from "../../src/auth/local/password.ts";
import { ATHENA_AUTH_DEFAULT_ARGON2 } from "../../src/auth/contract/index.ts";

function createTestHasher() {
  return {
    async hash(password: string) {
      return `$argon2id$v=19$m=1024,t=2,p=1$dGVzdHNhbHQ$${Buffer.from(password).toString("base64url")}`;
    },
    needsRehash(hash: string) {
      return passwordHashNeedsRehash(hash, ATHENA_AUTH_DEFAULT_ARGON2);
    },
    async verify(password: string, hash: string) {
      return hash.endsWith(Buffer.from(password).toString("base64url"));
    },
  };
}

test("B-EML-02 embedded runtime has no admin email-template list handler", { skip: "superseded by target suite test/email/email-engine.target.test.ts" }, async () => {
  const runtime = createAthenaAuthRuntime({
    autoMigrate: false,
    hasher: createTestHasher(),
  });
  const response = await runtime.handle(
    new Request("http://app.local/api/auth/admin/email-template/list")
  );
  assert.equal(response.status, 404);
});
