/**
 * N3 — `/server` cannot expose browser export conditions.
 */

import { strict as assert } from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const pkg = require(join(pkgRoot, "package.json")) as {
  exports: Record<string, Record<string, string> | string>;
};

test('N3: exports["./server"] has no browser condition', () => {
  const server = pkg.exports["./server"];
  assert.equal(typeof server, "object");
  assert.ok(server && !Array.isArray(server));
  assert.equal(
    Object.hasOwn(server as object, "browser"),
    false,
    "/server must not expose browser conditions"
  );
  assert.equal(
    (server as { import?: { default?: string } }).import?.default,
    "./dist/server.js"
  );
  assert.equal(
    (server as { require?: { types?: string } }).require?.types,
    "./dist/server.d.cts"
  );
});
