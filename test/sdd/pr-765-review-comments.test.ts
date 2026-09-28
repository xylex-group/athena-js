/**
 * PR #765 review-comment regressions. Each title is `P?: <exact subject>`.
 */
import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse as parseApiKey } from "../../src/cli/commands/api-key/index.ts";
import { AthenaRightKeyError } from "../../src/rights/errors.ts";
import { parseAthenaRightKey } from "../../src/rights/key.ts";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("P?: Preserve the DevTools typesVersions mapping", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    typesVersions?: Record<string, Record<string, string[]>>;
    exports?: Record<string, unknown>;
  };
  const star = pkg.typesVersions?.["*"] ?? {};
  assert.ok(
    star.devtools,
    "typesVersions must keep the existing devtools mapping for node/node10"
  );
  assert.ok(
    star.devtools.some((p) => p.includes("devtools.d.ts")),
    "devtools typesVersions must resolve to dist/devtools.d.ts, not the catch-all dist/index.d.ts"
  );
  assert.ok(star.rights, "typesVersions must add rights alongside devtools");
  assert.ok(star.rights.some((p) => p.includes("rights.d.ts")));
  assert.ok(pkg.exports?.["./devtools"]);
  assert.ok(pkg.exports?.["./rights"]);
});

test("P?: Remove the nonexistent notifications surface", () => {
  const manifest = readFileSync(
    join(pkgRoot, "docs", "type-surface-manifest.md"),
    "utf8"
  );
  assert.equal(
    manifest.includes("`notifications`"),
    false,
    "AthenaClient type-surface must not list a notifications namespace that does not exist"
  );
  assert.equal(
    /notifications/i.test(manifest),
    false,
    "type-surface-manifest must not document notifications until the feature lands"
  );
  assert.equal(
    manifest.includes("0055-athena-js-notifications-capability"),
    false,
    "must not link absent ADR 0055"
  );
});

test("P?: Reject empty right tokens before filtering them", () => {
  const foundCases = [",", "users.read,,tickets.read"] as const;
  for (const rightsCsv of foundCases) {
    let thrown: unknown;
    try {
      parseApiKey(["create", "--name", "app", "--rights", rightsCsv]);
    } catch (error) {
      thrown = error;
    }
    assert.ok(
      thrown instanceof AthenaRightKeyError,
      `--rights ${JSON.stringify(rightsCsv)} must fail closed instead of dropping empty CSV entries`
    );
    assert.equal(thrown.code, "RIGHT_KEY_EMPTY");
  }

  const valid = parseApiKey([
    "create",
    "--name",
    "app",
    "--rights",
    "users.read,tickets.read",
  ]);
  assert.equal(valid.command, "api-key-create");
  if (valid.command === "api-key-create") {
    assert.deepEqual(
      [...(valid.rights ?? [])].map((key) => String(key)),
      ["users.read", "tickets.read"]
    );
  }
});

test("P?: Match Rust whitespace canonicalization", () => {
  const foundBom = "\uFEFFgateway.query";
  let bomThrown: unknown;
  try {
    parseAthenaRightKey(foundBom);
  } catch (error) {
    bomThrown = error;
  }
  assert.ok(
    bomThrown instanceof AthenaRightKeyError,
    "U+FEFF is not Rust White_Space; JS trim() must not grant gateway.query"
  );
  assert.equal(bomThrown.code, "RIGHT_KEY_INVALID_CHARACTERS");

  const foundNel = "\u0085gateway.query";
  assert.equal(
    String(parseAthenaRightKey(foundNel)),
    "gateway.query",
    "U+0085 is Rust White_Space; JS trim() must strip NEL like str::trim()"
  );

  const fixture = JSON.parse(
    readFileSync(
      join(pkgRoot, "test", "fixtures", "rights", "key-parsing-v1.json"),
      "utf8"
    )
  ) as {
    cases?: Array<{
      canonical?: string;
      error?: string;
      input: string;
      ok: boolean;
    }>;
  };
  const cases = fixture.cases ?? [];
  const bomCase = cases.find((item) => item.input === "\uFEFFgateway.query");
  assert.ok(bomCase, "generated fixtures must include a leading U+FEFF case");
  assert.equal(bomCase.ok, false);
  assert.equal(bomCase.error, "RIGHT_KEY_INVALID_CHARACTERS");
  const nelCase = cases.find((item) => item.input === "\u0085gateway.query");
  assert.ok(nelCase, "generated fixtures must include a leading U+0085 case");
  assert.equal(nelCase.ok, true);
  assert.equal(nelCase.canonical, "gateway.query");
});
