#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runStructuralComplexityCheck } from "../../athena-auth-ui/scripts/lib/structural-complexity.mjs";
import { runFileStructuralComplexityCheck } from "./lib/file-structural-complexity.mjs";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const writeBaseline = args.has("--write-baseline");
const baselineDir = join(packageRoot, "scripts/structural-complexity");

const reactView = runStructuralComplexityCheck({
  baselinePath: join(
    packageRoot,
    "scripts/structural-complexity-baseline.json"
  ),
  cwd: packageRoot,
  roots: [join(packageRoot, "src/react")],
  writeBaseline,
});

const subsystems = [
  {
    extraFiles: [],
    name: "react",
    roots: [join(packageRoot, "src/react")],
  },
  {
    extraFiles: [],
    name: "billing",
    roots: [join(packageRoot, "src/billing")],
  },
  {
    extraFiles: [],
    name: "auth",
    roots: [join(packageRoot, "src/auth")],
  },
  {
    extraFiles: [],
    name: "runtime",
    roots: [join(packageRoot, "src/runtime")],
  },
  {
    extraFiles: [
      join(packageRoot, "src/client-fluent.ts"),
      join(packageRoot, "src/browser.ts"),
      join(packageRoot, "src/v3-client.ts"),
      join(packageRoot, "src/v3-client-core.ts"),
      join(packageRoot, "src/auxiliaries.ts"),
    ],
    name: "client",
    roots: [join(packageRoot, "src/client")],
  },
];

const fileResults = subsystems.map((subsystem) =>
  runFileStructuralComplexityCheck({
    baselinePath: join(baselineDir, `${subsystem.name}.json`),
    cwd: packageRoot,
    extraFiles: subsystem.extraFiles,
    name: subsystem.name,
    roots: subsystem.roots,
    writeBaseline,
  })
);

if (verbose) {
  for (const line of reactView.warnings) {
    console.warn(`[structural-complexity] warn ${line}`);
  }
}

const errors = [
  ...reactView.errors,
  ...fileResults.flatMap((result) => result.errors),
];
if (errors.length > 0) {
  console.error("[structural-complexity] FAILED:");
  for (const line of errors) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

const fileCount = fileResults.reduce((sum, result) => sum + result.files, 0);
console.log(
  `[structural-complexity] ok react-view-files=${reactView.files} file-metrics=${fileCount} warnings=${reactView.warnings.length}`
);
