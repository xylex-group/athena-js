/**
 * Packed dual-tarball consumer: @xylex-group/athena + @xylex-group/athena-auth-ui.
 */
import { strict as assert } from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(pkgRoot, "test", "fixtures", "next-minimal-golden");

function packedAuthUiRoot(): string {
  return join(fixtureRoot, "node_modules", "@xylex-group", "athena-auth-ui");
}

test("packed consumer installs athena-js and athena-auth-ui tarballs, not sibling source", () => {
  const require = createRequire(join(fixtureRoot, "package.json"));
  let athena: string;
  try {
    athena = require.resolve("@xylex-group/athena/server");
  } catch (error) {
    throw new Error(
      `packed @xylex-group/athena missing in next-minimal-golden: ${String(error)}`
    );
  }
  assert.equal(
    athena.replaceAll("\\", "/").includes("/packages/athena-js/src/"),
    false
  );

  assert.equal(
    existsSync(packedAuthUiRoot()),
    true,
    "packed @xylex-group/athena-auth-ui must be installed into next-minimal-golden"
  );
  const uiPkg = JSON.parse(
    readFileSync(join(packedAuthUiRoot(), "package.json"), "utf8")
  ) as { name?: string };
  assert.equal(uiPkg.name, "@xylex-group/athena-auth-ui");
  const real = require.resolve("@xylex-group/athena-auth-ui");
  assert.equal(
    real.replaceAll("\\", "/").includes("/packages/athena-auth-ui/src/"),
    false,
    "Auth UI must resolve from packed dist, not workspace src"
  );
});
