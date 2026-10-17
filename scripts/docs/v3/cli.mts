#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  canonicalDocsApiV3RightKeys,
  checkDocsApiV3,
  composeDocsApiV3,
  readValidatedDocsApiV3Artifacts,
  writeDocsApiV3,
} from "./compose.mts";

const packageRoot = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url))))
);
const check = process.argv.includes("--check");

try {
  const generated = composeDocsApiV3(packageRoot);
  if (check) {
    const current = readValidatedDocsApiV3Artifacts(packageRoot, {
      expectedPackageJsonDigest: generated.manifest.source.packageJsonDigest,
      inputDigests: new Map([
        ["manifest-inputs", generated.manifest.source.inputsDigest],
      ]),
      rightKeys: canonicalDocsApiV3RightKeys(),
    });
    const drift = checkDocsApiV3(packageRoot, generated);
    if (drift.length > 0) {
      console.error(
        `docs:check:v3 drift:\n${drift.map((item) => `  - ${item}`).join("\n")}`
      );
      process.exitCode = 1;
    } else {
      console.log(
        `docs:check:v3: ok (${current.symbols.symbols.length} symbols, ${current.bindings.bindings.length} bindings)`
      );
    }
  } else {
    writeDocsApiV3(packageRoot, generated);
    console.log(
      `docs:generate:v3: wrote ${generated.symbols.symbols.length} symbols and ${generated.bindings.bindings.length} bindings`
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
