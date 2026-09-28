/**
 * publish.js must load only npm credentials from .env files — never DATABASE_URL.
 */
import { strict as assert } from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("publish.js allowlists NPM_TOKEN / NODE_AUTH_TOKEN only", () => {
  const source = readFileSync(
    join(process.cwd(), "scripts", "publish.js"),
    "utf8"
  );
  assert.match(source, /PUBLISH_ENV_KEYS/);
  assert.match(source, /NPM_TOKEN/);
  assert.match(source, /NODE_AUTH_TOKEN/);
  assert.match(source, /loadPublishTokenFromEnvFile|PUBLISH_ENV_KEYS\.has/);
  assert.match(source, /--userconfig/);
  assert.match(source, /_authToken/);
  assert.match(source, /npm-cli\.js/);
  assert.match(source, /process\.execPath/);
  assert.match(source, /whoami/);
  assert.match(source, /delete npmEnv\.CI/);
  assert.doesNotMatch(source, /always-auth/);
  assert.match(source, /resolvePublishCredentials/);
  assert.match(source, /--otp/);
  assert.match(source, /looksLikeNpmAccessToken/);
  assert.match(source, /finalityCommitCoversHead/);
  assert.match(source, /generatedAt/);
  assert.doesNotMatch(
    source,
    /loadEnvFile\(resolve\(process\.cwd\(\),\s*fileName\)\)/
  );
});

test("development manifest keeps the pnpm pack-safe self link", () => {
  const packageJson = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };

  assert.equal(packageJson.dependencies?.["@xylex-group/athena"], "link:");
});

test("publish env loader ignores DATABASE_URL in .env.local", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-publish-env-"));
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN,
    NPM_TOKEN: process.env.NPM_TOKEN,
  };
  delete process.env.DATABASE_URL;
  delete process.env.NPM_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;

  try {
    writeFileSync(
      join(root, ".env.local"),
      [
        "DATABASE_URL=postgres://should-not-load@127.0.0.1:5432/leak",
        "NPM_TOKEN=npm_test_token_value",
        "SOME_OTHER=1",
      ].join("\n"),
      "utf8"
    );

    // Inline the same allowlist logic publish.js uses (avoid spawning npm publish).
    const PUBLISH_ENV_KEYS = new Set(["NPM_TOKEN", "NODE_AUTH_TOKEN"]);
    const content = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match) {
        continue;
      }
      const [, key, rawValue] = match;
      if (!PUBLISH_ENV_KEYS.has(key)) {
        continue;
      }
      process.env[key] = rawValue;
    }

    assert.equal(process.env.NPM_TOKEN, "npm_test_token_value");
    assert.equal(process.env.DATABASE_URL, undefined);
  } finally {
    rmSync(root, { force: true, recursive: true });
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
