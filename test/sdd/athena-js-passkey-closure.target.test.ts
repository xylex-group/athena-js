/**
 * next-minimal ordinary passkey config must not grow WebAuthn maintenance knobs.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const nextMinimalSrc = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "src"
);

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  if (!(existsSync(dir) && statSync(dir).isDirectory())) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(next));
      continue;
    }
    if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) {
      out.push(next);
    }
  }
  return out;
}

test("next-minimal ordinary config has no WebAuthn maintenance knobs", () => {
  const files = walkFiles(nextMinimalSrc).filter(
    (file) => !file.replaceAll("\\", "/").includes("/athena/generated/")
  );
  assert.ok(files.length > 0, "next-minimal src must exist");
  const joined = files.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.doesNotMatch(joined, /\brpId\b/);
  assert.doesNotMatch(joined, /\btrustedOrigins\b/);
  assert.doesNotMatch(
    joined,
    /passkeyOrigin|buildPasskeyOrigin|origin builder/i
  );
  assert.doesNotMatch(
    joined,
    /toJSON\(\)|PublicKeyCredential|navigator\.credentials/
  );
  assert.doesNotMatch(joined, /setInterval\s*\(|refetchInterval/);
  assert.match(joined, /passkey:\s*\{\s*onboarding:\s*true/);
  assert.match(joined, /APP_URL/);
});
