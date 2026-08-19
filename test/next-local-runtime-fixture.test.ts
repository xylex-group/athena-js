import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";

const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "next-local-runtime",
);

function readFixture(relativePath: string): string {
  return readFileSync(join(fixtureRoot, relativePath), "utf8");
}

test("canonical Next local-runtime fixture owns one root from @xylex-group/athena/server", () => {
  const root = readFixture("lib/athena/root.ts");
  assert.match(root, /import "server-only"/);
  assert.match(root, /from "@xylex-group\/athena\/server"/);
  assert.match(root, /createClient\(/);
  assert.match(root, /databaseUrl:\s*process\.env\.DATABASE_URL/);
  assert.match(root, /mode:\s*"local"/);
  assert.doesNotMatch(root, /createAthenaServerClient/);
});

test("canonical Next fixture request client borrows the root", () => {
  const server = readFixture("lib/athena/server.ts");
  assert.match(server, /import "server-only"/);
  assert.match(server, /createAthenaServerClient/);
  assert.match(server, /from "\.\/root/);
  assert.match(server, /client:\s*athena/);
});

test("canonical Next fixture browser client never sees DATABASE_URL", () => {
  const browser = readFixture("lib/athena/browser.ts");
  assert.match(browser, /["']use client["']/);
  assert.match(browser, /createAthenaBrowserClient/);
  assert.match(browser, /discover:\s*"next"/);
  assert.match(browser, /prefer:\s*"local"/);
  assert.doesNotMatch(browser, /DATABASE_URL/);
  assert.doesNotMatch(browser, /@xylex-group\/athena\/server/);
});

test("canonical Next fixture routes share the same root", () => {
  const data = readFixture("app/api/athena/[...path]/route.ts");
  const auth = readFixture("app/api/auth/[...all]/route.ts");
  assert.match(data, /createAthenaNextHandlers/);
  assert.match(auth, /createAthenaNextHandlers/);
  assert.match(data, /from ".*lib\/athena\/root/);
  assert.match(auth, /from ".*lib\/athena\/root/);
  assert.match(data, /DELETE,\s*GET,\s*PATCH,\s*POST/);
  assert.match(auth, /GET,\s*POST/);
});
