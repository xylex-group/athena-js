#!/usr/bin/env node
/**
 * Pack @xylex-group/athena into a temp dir and validate the published artifact.
 * Does not write tarballs into the package working directory.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";

function resolveBin(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(bin, args, options) {
  return execFileSync(resolveBin(bin), args, {
    ...options,
    shell: process.platform === "win32",
  });
}
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const ALLOWED_TOP = new Set(["package", "package.json"]);
const ALLOWED_PREFIXES = ["package/dist/", "package/bin/", "package/README.md", "package/LICENSE", "package/package.json"];
const FORBIDDEN = [
  /^package\/src\//,
  /^package\/test\//,
  /^package\/coverage\//,
  /^package\/\.env/,
  /^package\/docs\/sdd\//,
  /^package\/\.git\//,
];

const SECRET_PATTERNS = [
  { name: "BEGIN PRIVATE KEY", re: /BEGIN [A-Z ]*PRIVATE KEY/ },
  {
    name: "DATABASE_URL assignment",
    re: /DATABASE_URL=(?:postgres|postgresql):\/\/(?!user:password@example)(?!postgres:postgres@)/,
  },
  {
    name: "ATHENA_API_KEY assignment",
    re: /ATHENA_API_KEY=(?!process\.env)(?!your-)(?!publishable)[A-Za-z0-9_\-]{16,}/,
  },
  {
    name: "ATHENA_AUTH_SECRET assignment",
    re: /ATHENA_AUTH_SECRET=(?!process\.env)(?!your-)(?!change-me)[A-Za-z0-9_\-]{8,}/,
  },
  { name: "ghp_", re: /ghp_[A-Za-z0-9]{20,}/ },
  { name: "github_pat_", re: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: "npm_", re: /npm_[A-Za-z0-9]{20,}/ },
];

const PLACEHOLDER_ALLOW = [
  "postgresql://user:password@example",
  "postgres://user:password@example",
  "process.env.DATABASE_URL",
  "process.env.ATHENA_API_KEY",
  "your-api-key",
];

function fail(message) {
  console.error(`check-release-tarball: ${message}`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

function posixRel(from, file) {
  return relative(from, file).split(sep).join("/");
}

const work = mkdtempSync(join(tmpdir(), "athena-js-tarball-"));
const packDir = join(work, "pack");
const extractDir = join(work, "extract");
mkdirSync(packDir);
mkdirSync(extractDir);

let report;
try {
  const packedOut = run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const tarballName = packedOut.split(/\s+/).filter((line) => line.endsWith(".tgz")).at(-1);
  if (!tarballName) {
    fail("pnpm pack did not produce a tarball");
  }
  const tarballPath = existsSync(tarballName) ? tarballName : join(packDir, tarballName);
  if (!existsSync(tarballPath)) {
    const listed = readdirSync(packDir);
    const found = listed.find((name) => name.endsWith(".tgz"));
    if (!found) {
      fail(`tarball missing after pack (${packedOut})`);
    }
    report = { tarballPath: join(packDir, found) };
  } else {
    report = { tarballPath };
  }

  execFileSync("tar", ["-xzf", report.tarballPath, "-C", extractDir], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const files = walk(extractDir);
  const relativeFiles = files.map((file) => posixRel(extractDir, file));

  for (const file of relativeFiles) {
    for (const forbidden of FORBIDDEN) {
      if (forbidden.test(file)) {
        fail(`forbidden path in tarball: ${file}`);
      }
    }
    const allowed =
      file === "package/package.json" ||
      file === "package/README.md" ||
      file === "package/LICENSE" ||
      file.startsWith("package/dist/") ||
      file.startsWith("package/bin/");
    if (!allowed && !ALLOWED_TOP.has(file.split("/")[0] ?? "")) {
      fail(`unexpected path in tarball: ${file}`);
    }
    if (!allowed && file.startsWith("package/") && !file.startsWith("package/dist/") && !file.startsWith("package/bin/")) {
      fail(`unexpected package content: ${file}`);
    }
  }

  for (const required of [
    "package/package.json",
    "package/README.md",
    "package/LICENSE",
    "package/dist/index.js",
    "package/dist/index.cjs",
    "package/dist/server.js",
    "package/dist/server.cjs",
    "package/dist/server.d.ts",
    "package/dist/next/client.js",
    "package/dist/next/server.js",
    "package/bin/athena-js.js",
  ]) {
    if (!relativeFiles.includes(required)) {
      fail(`missing required file: ${required}`);
    }
  }

  const packedPkg = JSON.parse(
    readFileSync(join(extractDir, "package", "package.json"), "utf8")
  );
  if (packedPkg.name !== pkg.name || packedPkg.version !== pkg.version) {
    fail("packed package.json name/version mismatch");
  }
  if (!packedPkg.exports || typeof packedPkg.exports !== "object") {
    fail("packed package.json missing exports");
  }
  const serverExport = packedPkg.exports["./server"];
  if (!serverExport || serverExport.import !== "./dist/server.js") {
    fail('packed package.json missing "./server" export to ./dist/server.js');
  }
  if (serverExport.browser) {
    fail('"./server" must not declare a browser condition');
  }

  const secretHits = [];
  for (const file of files) {
    if (statSync(file).size > 2_000_000) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    if (PLACEHOLDER_ALLOW.some((token) => text.includes(token)) && !/ghp_|github_pat_|npm_[A-Za-z0-9]{20,}/.test(text)) {
      // still scan non-placeholder secrets
    }
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.re.test(text)) {
        const rel = posixRel(extractDir, file);
        const benign = PLACEHOLDER_ALLOW.some((token) => text.includes(token));
        if (pattern.name.startsWith("DATABASE_URL") && benign) {
          continue;
        }
        if (pattern.name === "ATHENA_API_KEY=" && text.includes("process.env.ATHENA_API_KEY")) {
          continue;
        }
        secretHits.push(`${rel}: ${pattern.name}`);
      }
    }
  }
  if (secretHits.length > 0) {
    fail(`secret-like strings in tarball:\n${secretHits.join("\n")}`);
  }

  const bytes = statSync(report.tarballPath).size;
  const sha256 = createHash("sha256").update(readFileSync(report.tarballPath)).digest("hex");
  const sizes = files
    .map((file) => ({ file: posixRel(extractDir, file), bytes: statSync(file).size }))
    .sort((a, b) => b.bytes - a.bytes);

  const metadata = {
    name: packedPkg.name,
    version: packedPkg.version,
    commit: process.env.GITHUB_SHA ?? process.env.COMMIT_SHA ?? null,
    tarballSha256: sha256,
    tarballBytes: bytes,
    unpackedBytes: sizes.reduce((sum, row) => sum + row.bytes, 0),
    fileCount: files.length,
    largestFiles: sizes.slice(0, 15),
    exports: Object.keys(packedPkg.exports),
    checks: {
      files: "pass",
      secrets: "pass",
      exports: "pass",
    },
  };

  const evidenceDir = join(root, ".release-evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(
    join(evidenceDir, "tarball-report.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  );

  // Isolated ESM + CJS import of the packed artifact.
  const consumer = join(work, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "athena-packed-consumer",
        private: true,
        type: "module",
        dependencies: {
          [pkg.name]: `file:${report.tarballPath}`,
        },
      },
      null,
      2
    )
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: consumer,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const esmProbe = join(consumer, "esm-probe.mjs");
  writeFileSync(
    esmProbe,
    `import { createClient } from "${pkg.name}";
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("ESM createClient missing from()");
console.log("packed-esm:ok");
`
  );
  execFileSync(process.execPath, [esmProbe], { cwd: consumer, stdio: "inherit" });

  const cjsDir = join(work, "cjs-consumer");
  mkdirSync(cjsDir);
  writeFileSync(
    join(cjsDir, "package.json"),
    JSON.stringify(
      {
        name: "athena-packed-cjs",
        private: true,
        type: "commonjs",
        dependencies: { [pkg.name]: `file:${report.tarballPath}` },
      },
      null,
      2
    )
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: cjsDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const cjsProbe = join(cjsDir, "cjs-probe.cjs");
  writeFileSync(
    cjsProbe,
    `const { createClient } = require("${pkg.name}");
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("CJS createClient missing from()");
console.log("packed-cjs:ok");
`
  );
  execFileSync(process.execPath, [cjsProbe], { cwd: cjsDir, stdio: "inherit" });

  const rnProbe = join(consumer, "rn-probe.mjs");
  writeFileSync(
    rnProbe,
    `import * as rn from "${pkg.name}/react-native";
if (!rn || typeof rn !== "object") throw new Error("react-native export empty");
console.log("packed-rn:ok");
`
  );
  execFileSync(process.execPath, [rnProbe], { cwd: consumer, stdio: "inherit" });

  const serverProbe = join(consumer, "server-probe.mjs");
  writeFileSync(
    serverProbe,
    `import { createClient } from "${pkg.name}/server";
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("server createClient missing from()");
if (typeof client.close !== "function") throw new Error("server createClient missing close()");
console.log("packed-server:ok");
`
  );
  // ./server imports "server-only"; probe through the same shim unit tests use.
  const serverOnlyRegister = pathToFileURL(
    join(root, "test", "register-server-only.mjs")
  ).href;
  execFileSync(
    process.execPath,
    ["--import", serverOnlyRegister, serverProbe],
    {
      cwd: consumer,
      stdio: "inherit",
    }
  );

  metadata.checks.packedEsm = "pass";
  metadata.checks.packedCjs = "pass";
  metadata.checks.packedServer = "pass";
  metadata.checks.packedReactNative = "pass";
  writeFileSync(
    join(evidenceDir, "tarball-report.json"),
    `${JSON.stringify(metadata, null, 2)}\n`
  );

  console.log(
    `check-release-tarball: ok files=${metadata.fileCount} bytes=${metadata.tarballBytes} sha256=${sha256}`
  );
} finally {
  rmSync(work, { force: true, recursive: true });
}
