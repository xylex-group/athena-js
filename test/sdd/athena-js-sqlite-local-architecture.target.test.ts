import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("SQLite Local semantic and host adapters have closed dependency boundaries", async () => {
  const semantic = await readFile(new URL("../../src/sqlite-local/compatibility.ts", import.meta.url), "utf8");
  assert.match(semantic, /Query V1 projector only/);
  const transport = await readFile(new URL("../../src/sqlite-local/transport.ts", import.meta.url), "utf8");
  const rn = await readFile(new URL("../../src/react-native/sqlite-local.ts", import.meta.url), "utf8");
  assert.doesNotMatch(semantic, /cloudflare|D1Database|workers-types/i);
  assert.doesNotMatch(transport, /D1Database|workers-types/i);
  assert.doesNotMatch(rn, /better-auth|postgres|sqlite3|expo-sqlite|react-native-sqlite/i);
});

test("SQLite Local does not add a second client database surface", async () => {
  const source = await readFile(new URL("../../src/v3-client-core.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /db\.sqlite/);
});
