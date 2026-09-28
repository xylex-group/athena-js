/**
 * RED: DevTools is explicit opt-in plus operator Right or loopback; not NODE_ENV alone.
 */
import { strict as assert } from "node:assert/strict";
import { test } from "node:test";
import { isAthenaDevtoolsHttpEnabled } from "../../../src/devtools/http/index.ts";
import { readSrc } from "./helpers.ts";

test("DevTools HTTP requires an explicit opt-in", () => {
  const source = readSrc("devtools", "http", "index.ts");
  assert.match(source, /ATHENA_DEVTOOLS_HTTP/);
  assert.equal(
    isAthenaDevtoolsHttpEnabled({ NODE_ENV: "development" }),
    false,
    "tunneled development servers must not enable DevTools from NODE_ENV alone"
  );
});

test("public /capabilities does not embed a DevTools snapshot", () => {
  const adapter = readSrc("gateway", "server", "adapter.ts");
  assert.equal(adapter.includes("payload.devtools"), false);
  assert.match(adapter, /runtime\.devtools\.read|loopback/);
});
