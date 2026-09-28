/**
 * Target: packed-consumer config leaf. Loading athena.config.ts must not
 * evaluate Auth/WebAuthn. ADR 0072.
 */
import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const distRoot = join(pkgRoot, "dist");
const authUiRoot = join(pkgRoot, "..", "athena-auth-ui");
const UNROUTABLE = "postgres://127.0.0.1:1/athena_config_leaf";
const ASN_POISON = /AlgorithmIdentifier|Cannot get schema for/i;
const CONFIG_IMPORT_FAILED = /ATHENA_CONFIG_IMPORT_FAILED/;
const FORBIDDEN_CONFIG_LEAF = [
  "@simplewebauthn",
  "@peculiar/asn1-schema",
  "AlgorithmIdentifier",
  "server-only",
  "v3-client",
  "createPasskeyModule",
] as const;

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

function readPublicSrc(): string {
  return readFileSync(join(pkgRoot, "src", "config", "public.ts"), "utf8");
}

function spawnNode(
  args: string[],
  cwd: string,
  env?: NodeJS.ProcessEnv
): { combined: string; status: number | null } {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
  });
  return {
    combined: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    status: result.status,
  };
}

function resolvePnpmJs(): string {
  const candidates = [
    join(
      dirname(process.execPath),
      "node_modules",
      "corepack",
      "dist",
      "pnpm.js"
    ),
    join(pkgRoot, "node_modules", "pnpm", "bin", "pnpm.cjs"),
  ];
  const found = candidates.find((path) => existsSync(path));
  assert.equal(
    found != null,
    true,
    `pnpm.js not found next to Node (${process.execPath})`
  );
  return found ?? candidates[0];
}

function spawnPnpm(
  args: string[],
  cwd: string,
  timeoutMs?: number
): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [resolvePnpmJs(), ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    shell: false,
    timeout: timeoutMs,
    windowsHide: true,
  });
}

function packPackage(cwd: string, dest: string): string {
  mkdirSync(dest, { recursive: true });
  const packed = spawnPnpm(["pack", "--pack-destination", dest], cwd, 180_000);
  const stdout = `${packed.stdout ?? ""}\n${packed.stderr ?? ""}`;
  assert.equal(
    packed.status,
    0,
    `pnpm pack failed (${String(packed.status ?? packed.error?.message)}): ${stdout}`
  );
  const match = stdout.match(/(\S+\.tgz)/);
  assert.equal(match !== null, true, "pnpm pack must print a tarball path");
  const printed = match?.[1] ?? "";
  const name = printed.replaceAll("\\", "/").split("/").at(-1) ?? printed;
  const tarball = join(dest, name);
  assert.equal(existsSync(tarball), true, tarball);
  return tarball;
}

test("T-CFG-01: P?: ./config is a published Node tooling leaf", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    exports?: Record<
      string,
      { import?: { default?: string; types?: string } }
    >;
  };
  assert.equal(pkg.exports?.["./config"]?.import?.default, "./dist/config.js");
  assert.equal(pkg.exports?.["./config"]?.import?.types, "./dist/config.d.ts");
  assert.equal("./config/node" in (pkg.exports ?? {}), false);
  const src = readPublicSrc();
  assert.match(src, /defineAthenaConfig/);
  assert.match(src, /generatorEnv/);
  assert.doesNotMatch(src, /from ["'].*v3-client/);
  assert.doesNotMatch(src, /simplewebauthn/);
  assert.doesNotMatch(src, /auth\/local/);
});

test("T-CFG-02: P?: CLI templates import defineAthenaConfig from ./config", () => {
  const renderer = readFileSync(
    join(pkgRoot, "src", "generator", "config-file.ts"),
    "utf8"
  );
  assert.match(
    renderer,
    /from "@xylex-group\/athena\/config"/
  );
  assert.doesNotMatch(
    renderer,
    /return `import \{ defineAthenaConfig, generatorEnv \} from "@xylex-group\/athena";/
  );
});

test("T-CFG-03: P?: built dist/config.js has no Auth or WebAuthn graph", () => {
  const configJs = join(distRoot, "config.js");
  assert.equal(
    existsSync(configJs),
    true,
    "dist/config.js required (run pnpm build)"
  );
  const text = readFileSync(configJs, "utf8");
  for (const needle of FORBIDDEN_CONFIG_LEAF) {
    assert.equal(
      text.includes(needle),
      false,
      `dist/config.js must not contain ${needle}`
    );
  }
});

test("T-CFG-04: P?: packed leaf createClient graph stays off config import", () => {
  const configJs = join(distRoot, "config.js");
  assert.equal(existsSync(configJs), true, "dist/config.js required (run pnpm build)");
  const probe = spawnNode(
    [
      "-e",
      `import(${JSON.stringify(pathToFileURL(configJs).href)}).then((mod) => {
        if (typeof mod.defineAthenaConfig !== "function") throw new Error("missing defineAthenaConfig");
        if (typeof mod.generatorEnv !== "function") throw new Error("missing generatorEnv");
        if ("createClient" in mod) throw new Error("createClient leaked onto ./config");
        console.log("config-leaf:ok");
      })`,
    ],
    pkgRoot
  );
  assert.equal(probe.status, 0, probe.combined);
  assert.match(probe.combined, /config-leaf:ok/);
  assert.doesNotMatch(probe.combined, ASN_POISON);
});

test("T-CFG-05: P?: packed Athena + Auth UI + Next migrate status gets past config load", () => {
  const configJs = join(distRoot, "config.js");
  const cliJs = join(distRoot, "cli", "index.js");
  assert.equal(
    existsSync(configJs) && existsSync(cliJs),
    true,
    "dist/config.js and dist/cli/index.js required (run pnpm build)"
  );
  const work = mkdtempSync(join(tmpdir(), "athena-config-leaf-"));
  try {
    const packDir = join(work, "pack");
    const athenaTgz = packPackage(pkgRoot, packDir);
    const authUiTgz = packPackage(authUiRoot, packDir);
    const fixture = join(work, "app");
    mkdirSync(join(fixture, "athena", "migrations"), { recursive: true });
    writeFileSync(
      join(fixture, "package.json"),
      `${JSON.stringify(
        {
          dependencies: {
            "@xylex-group/athena": `file:${posix(athenaTgz)}`,
            "@xylex-group/athena-auth-ui": `file:${posix(authUiTgz)}`,
            next: `file:${posix(join(pkgRoot, "node_modules", "next"))}`,
            pg: `file:${posix(join(pkgRoot, "node_modules", "pg"))}`,
            react: `file:${posix(join(pkgRoot, "node_modules", "react"))}`,
          },
          name: "athena-books-like-fixture",
          private: true,
          type: "module",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    writeFileSync(
      join(fixture, "athena.config.ts"),
      `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena/config";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL", {
      default: ${JSON.stringify(UNROUTABLE)},
    }),
  },
  migrations: { directory: "athena/migrations" },
});
`,
      "utf8"
    );
    const install = spawnPnpm(
      ["install", "--ignore-workspace", "--offline"],
      fixture,
      180_000
    );
    const installText = `${install.stdout ?? ""}\n${install.stderr ?? ""}`;
    if (install.status !== 0) {
      const retry = spawnPnpm(
        ["install", "--ignore-workspace", "--ignore-scripts"],
        fixture,
        180_000
      );
      const retryText = `${retry.stdout ?? ""}\n${retry.stderr ?? ""}`;
      const installCompletedWithIgnoredBuilds =
        retryText.includes("ERR_PNPM_IGNORED_BUILDS");
      assert.equal(
        retry.status === 0 || installCompletedWithIgnoredBuilds,
        true,
        `${installText}\n${retryText}`
      );
    }
    const resolvedAthena = join(
      fixture,
      "node_modules",
      "@xylex-group",
      "athena"
    );
    assert.equal(
      posix(resolvedAthena).includes("/packages/athena-js/src/"),
      false
    );
    const bin = join(resolvedAthena, "bin", "athena-js.js");
    const migrate = spawnNode(
      [bin, "migrate", "status"],
      fixture,
      { DATABASE_URL: UNROUTABLE }
    );
    assert.doesNotMatch(migrate.combined, ASN_POISON);
    assert.doesNotMatch(migrate.combined, CONFIG_IMPORT_FAILED);
    assert.match(
      migrate.combined,
      /ECONNREFUSED|connect ECONNREFUSED|AUTH001|unreachable|status|No pending|pending/i
    );
  } finally {
    rmSync(work, { force: true, recursive: true });
  }
});
