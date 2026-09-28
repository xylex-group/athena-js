/**
 * Published-artifact regression for #1079.
 *
 * The fixture imports the universal root, generated models, and Auth UI from
 * pristine tarballs. A Webpack build must traverse those package exports
 * without treating filesystem path calculations as bundle dependencies.
 */

import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(
  packageRoot,
  "test",
  "fixtures",
  "next-minimal-golden"
);

test("pristine Athena tarball survives a Next Webpack build", () => {
  const require = createRequire(join(fixtureRoot, "package.json"));
  const resolved = require.resolve("@xylex-group/athena");
  assert.equal(
    resolved.replaceAll("\\", "/").includes("/packages/athena-js/src/"),
    false,
    "Webpack regression must exercise the packed dist/index.js artifact"
  );

  const command = process.platform === "win32" ? process.execPath : "pnpm";
  const args =
    process.platform === "win32"
      ? [
          join(
            dirname(process.execPath),
            "node_modules",
            "corepack",
            "dist",
            "pnpm.js"
          ),
          "run",
          "build",
        ]
      : ["run", "build"];
  const result = spawnSync(command, args, {
    cwd: fixtureRoot,
    encoding: "utf8",
    env: process.env,
    shell: false,
  });
  assert.equal(
    result.status,
    0,
    `Next Webpack build failed:\n${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`
  );
});
