import { strict as assert } from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

test("watch overlay skips the dts worker that OOMs next to Next/Vite", () => {
  const tsup = readFileSync(join(packageRoot, "tsup.config.ts"), "utf8");
  assert.match(tsup, /ATHENA_TSUP_WATCH/);
  assert.match(tsup, /dts:\s*isWatch\s*\?\s*false/);
  assert.match(tsup, /clean:\s*!isWatch/);
  assert.match(tsup, /\.sql": "text"/);
  assert.doesNotMatch(tsup, /stampServerEmailDts/);
  assert.doesNotMatch(tsup, /onSuccess:\s*stampGeneratedDts/);

  const pkg = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8")
  ) as { scripts: { build: string; dev: string } };
  const build = readFileSync(
    join(packageRoot, "scripts", "tsup-build.mjs"),
    "utf8"
  );
  assert.match(build, /max-old-space-size=16384/);
  assert.match(build, /tsup\/dist\/cli-default\.js/);
  assert.match(pkg.scripts.build, /tsup-build/);
  assert.match(pkg.scripts.dev, /assert-published-dts/);
  assert.match(pkg.scripts.dev, /ATHENA_TSUP_WATCH=1/);
  assert.match(pkg.scripts.dev, /tsup --watch/);
});
