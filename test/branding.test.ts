import { strict as assert } from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("package metadata uses athena-js branding", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8")
  ) as {
    name: string;
    bin: Record<string, string>;
  };

  assert.equal(pkg.name, "@xylex-group/athena");
  assert.equal(pkg.bin["athena-js"], "bin/athena-js.js");
});
