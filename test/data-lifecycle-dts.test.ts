/**
 * Published data-lifecycle types must be importable from root and ./runtime,
 * and createClient({ lifecycle.data }) must contextually type hook events.
 */
import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readPkgJson(): {
  exports?: Record<
    string,
    { import?: { types?: string }; require?: { types?: string } } | undefined
  >;
  typesVersions?: { "*": Record<string, string[]> };
} {
  return JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
}

test("package.json keeps data-lifecycle types on existing ./runtime and root", () => {
  const pkg = readPkgJson();
  assert.equal(pkg.exports?.["./runtime"]?.import?.types, "./dist/runtime.d.ts");
  assert.equal(pkg.exports?.["./runtime"]?.require?.types, "./dist/runtime.d.cts");
  assert.equal(pkg.exports?.["."]?.import?.types, "./dist/index.d.ts");
  assert.equal(pkg.exports?.["."]?.require?.types, "./dist/index.d.cts");
  assert.equal("lifecycle" in (pkg.exports ?? {}), false);
  assert.deepEqual(pkg.typesVersions?.["*"]?.runtime, ["dist/runtime.d.ts"]);

  const rootSrc = readFileSync(join(packageRoot, "src", "index.ts"), "utf8");
  assert.match(
    rootSrc,
    /export type \{[\s\S]*AthenaDataLifecycleEvent[\s\S]*\} from "\.\/runtime\/data\/lifecycle\/index\.ts"/
  );

  const runtimeSrc = readFileSync(
    join(packageRoot, "src", "runtime", "data", "index.ts"),
    "utf8"
  );
  assert.match(runtimeSrc, /AthenaDataLifecycleConfig/);
  assert.match(runtimeSrc, /AthenaDataLifecycleEvent/);
  assert.match(runtimeSrc, /from "\.\/lifecycle\/types\.ts"/);
  assert.match(runtimeSrc, /from "\.\/lifecycle\/events\.ts"/);
  assert.equal(/nucleus/.test(runtimeSrc), false);
  assert.equal(
    runtimeSrc.includes("executeDataMutation"),
    false,
    "runtime barrel must not export nucleus/lifecycle runtime functions"
  );
});

test("published DTS contextually types lifecycle.data afterInsert(event)", () => {
  const indexDts = join(packageRoot, "dist", "index.d.ts");
  const runtimeDts = join(packageRoot, "dist", "runtime.d.ts");
  assert.equal(
    existsSync(indexDts) && existsSync(runtimeDts),
    true,
    "dist/index.d.ts and dist/runtime.d.ts missing; run pnpm build"
  );

  const indexText = readFileSync(indexDts, "utf8");
  const runtimeText = readFileSync(runtimeDts, "utf8");
  assert.match(indexText, /AthenaDataLifecycleEvent/);
  assert.match(indexText, /AthenaDataLifecycleHook/);
  assert.match(runtimeText, /AthenaDataLifecycleEvent/);
  assert.match(runtimeText, /AthenaDataLifecycleEventName/);
  assert.equal(/createAthenaDataNucleus/.test(runtimeText), false);

  const tsc = createRequire(join(packageRoot, "package.json")).resolve(
    "typescript/bin/tsc"
  );
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      tsc,
      "-p",
      "test/tsconfig.data-lifecycle-dts.json",
      "--pretty",
      "false",
    ],
    {
      cwd: packageRoot,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
    }
  );
  assert.equal(
    result.status,
    0,
    `consumer DTS must type afterInsert(event) from published declarations (event is not any):\n${result.stdout}\n${result.stderr}`
  );
});
