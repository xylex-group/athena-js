import assert from "node:assert/strict";
import test from "node:test";

import {
  createGatewayCapabilities,
  createPostgresDirectCapabilities,
} from "../../src/cloudflare/capabilities.ts";

test("baseline: gateway and direct clients retain their public capability shape", () => {
  const gateway = createGatewayCapabilities();
  const direct = createPostgresDirectCapabilities();
  assert.equal(gateway.mode, "gateway");
  assert.equal(gateway.db.engine, "postgresql");
  assert.equal(gateway.db.local, false);
  assert.equal(direct.db.local, true);
  assert.equal(direct.storage.objects, false);
});
