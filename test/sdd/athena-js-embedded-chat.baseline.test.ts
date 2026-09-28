/**
 * Embedded Chat baseline — GREEN against current product behavior.
 * See docs/sdd/xylex/athena-js-embedded-chat/dual-suite/dual-suite-spec.md
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "../../src/v3-client.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

test("B-CHAT-REMOTE: createChatModule still issues HTTP for remote Chat", () => {
  const remote = readSrc("chat/remote/runtime.ts");
  assert.match(remote, /fetch\(/);
  assert.match(readSrc("chat/module.ts"), /createRemoteChatRuntime/);
});

test("B-CHAT-UNAVAILABLE: omitted chat stays an unavailable namespace", () => {
  const client = createClient({
    key: "pk_test_chat_baseline",
    url: "https://gateway.example.test",
  });
  assert.equal(typeof client.chat.room.list, "function");
});

test("B-CHAT-ADAPTER-FROM-URL: chat-adapter still exports FromUrl", () => {
  const clientSrc = readFileSync(
    join(pkgRoot, "..", "chat-adapter-athena", "src", "client.ts"),
    "utf8"
  );
  assert.match(clientSrc, /export function createAthenaAdapterFromUrl/);
});

test("B-CHAT-NO-SECOND-POOL-HELPER: local Chat database does not own createPostgresPool", () => {
  if (!existsSync(join(srcRoot, "chat", "local", "database.ts"))) {
    return;
  }
  const source = readSrc("chat/local/database.ts");
  assert.doesNotMatch(source, /createPostgresPool\(/);
});
