/**
 * Target: CLI / config runtime boundary DESIRED behavior.
 * GREEN after ADR 0064. Baseline retired to test/sdd/superseded/.
 *
 * See docs/sdd/xylex/athena-js-cli-config-runtime-boundary/dual-suite/dual-suite-spec.md
 */

import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");
const distRoot = join(pkgRoot, "dist");
const UNROUTABLE_DATABASE_URL = "postgres://127.0.0.1:1/athena_boundary_probe";

const SERVER_ONLY_POISON =
  /Client Component|server-only|should only be used from a Server Component/i;
const CONNECT_REFUSED = /ECONNREFUSED|connect ECONNREFUSED|AUTH001/i;

const SERVER_ONLY_ALLOWLIST = new Set([
  "server.ts",
  "next/server.ts",
  "next/session.ts",
  "auth/server-entry.ts",
  "email-node/index.ts",
  "auth/social/server/social-config.ts",
]);

const CHILD_PROBE_TIMEOUT_MS = 180_000;

const SERVER_ONLY_FORBIDDEN_DIRS = [
  "runtime",
  "generator",
  "migrations",
  "auth/local",
  "postgres",
  "schema",
  "cli",
] as const;

const CLI_FORBIDDEN_SPECIFIERS = [
  "server-only",
  "next/server",
  "next/headers",
  "next/navigation",
  "@xylex-group/athena/server",
  "@xylex-group/athena/next/server",
] as const;

const SERVER_ONLY_IMPORT_RE =
  /\bimport\s*["']server-only["']|\bfrom\s*["']server-only["']|\brequire\(\s*["']server-only["']\s*\)/;

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectFiles(full, suffix));
      continue;
    }
    if (entry.name.endsWith(suffix)) {
      out.push(full);
    }
  }
  return out;
}

function srcRel(file: string): string {
  return posix(relative(srcRoot, file));
}

function childEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const options = env.NODE_OPTIONS ?? "";
  if (options.length > 0) {
    env.NODE_OPTIONS = options
      .split(/\s+/)
      .filter(
        (token) => token.length > 0 && !/register-server-only/i.test(token)
      )
      .join(" ")
      .replace(/--import\s*$/g, "")
      .trim();
  }
  env.DATABASE_URL = UNROUTABLE_DATABASE_URL;
  env.ATHENA_GENERATOR_PG_URL = UNROUTABLE_DATABASE_URL;
  env.CI = "true";
  return env;
}

function spawnPlainNode(
  args: string[],
  cwd = pkgRoot
): {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
} {
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    env: childEnv(),
    timeout: CHILD_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const signal = result.signal ?? "";
  const spawnError = result.error?.message ?? "";
  return {
    combined: `${stdout}\n${stderr}${signal ? `\nspawn signal=${signal}` : ""}${spawnError ? `\nspawn error=${spawnError}` : ""}`,
    status: result.status,
    stderr,
    stdout,
  };
}

function spawnPlainTs(source: string): {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-boundary-target-"));
  const file = join(dir, "probe.ts");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ type: "module" })}\n`,
    "utf8"
  );
  writeFileSync(file, source, "utf8");
  const require = createRequire(join(pkgRoot, "package.json"));
  const tsx = pathToFileURL(require.resolve("tsx")).href;
  const sqlText = pathToFileURL(join(here, "..", "register-sql-text.mjs")).href;
  try {
    return spawnPlainNode(["--import", sqlText, "--import", tsx, file]);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function writeRootHelperFixture(entry: "src" | "dist" = "src"): {
  cwd: string;
  cleanup: () => void;
} {
  const cwd = mkdtempSync(join(tmpdir(), "athena-cli-boundary-target-fx-"));
  const shimDir = join(cwd, "node_modules", "@xylex-group", "athena");
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    join(shimDir, "package.json"),
    `${JSON.stringify({
      exports: { ".": entry === "dist" ? "./index.js" : "./index.ts" },
      name: "@xylex-group/athena",
      type: "module",
    })}\n`,
    "utf8"
  );
  const indexUrl =
    entry === "dist"
      ? pathToFileURL(join(distRoot, "index.js")).href
      : pathToFileURL(join(srcRoot, "index.ts")).href;
  writeFileSync(
    join(shimDir, entry === "dist" ? "index.js" : "index.ts"),
    `export * from ${JSON.stringify(indexUrl)};\n`,
    "utf8"
  );
  writeFileSync(
    join(cwd, "athena.config.ts"),
    `import { defineAthenaConfig, generatorEnv } from "@xylex-group/athena";

export default defineAthenaConfig({
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: generatorEnv("DATABASE_URL", {
      default: "postgres://127.0.0.1:1/athena_boundary_probe",
    }),
  },
  migrations: { directory: "athena/migrations" },
});
`,
    "utf8"
  );
  return {
    cleanup() {
      rmSync(cwd, { force: true, recursive: true });
    },
    cwd,
  };
}

function assertNotServerOnlyPoison(text: string, label: string): void {
  assert.doesNotMatch(
    text,
    SERVER_ONLY_POISON,
    `${label} must not be Client Component / server-only: ${text}`
  );
}

function jsonLine<T>(stdout: string, prefix: string): T {
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (line === undefined) {
    assert.fail(`missing ${prefix} in ${stdout}`);
  }
  return JSON.parse(line.slice(prefix.length)) as T;
}

function collectCliHits(root: string): string[] {
  const hits: string[] = [];
  for (const file of collectFiles(root, ".ts").concat(
    collectFiles(root, ".js"),
    collectFiles(root, ".cjs")
  )) {
    const source = readFileSync(file, "utf8");
    const cleaned = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "");
    for (const specifier of CLI_FORBIDDEN_SPECIFIERS) {
      const importHit = new RegExp(
        `(?:from|import|require\\()\\s*["']${specifier.replaceAll("/", "\\/")}["']`
      );
      if (
        importHit.test(cleaned) ||
        (specifier === "server-only" && SERVER_ONLY_IMPORT_RE.test(cleaned))
      ) {
        hits.push(`${posix(relative(pkgRoot, file))} -> ${specifier}`);
      }
    }
  }
  return hits;
}

test("T-01: P?: plain Node imports @xylex-group/athena without server-only hook", () => {
  const distIndex = join(distRoot, "index.js");
  const useBuiltRoot = existsSync(distIndex);
  const indexUrl = pathToFileURL(
    useBuiltRoot ? distIndex : join(srcRoot, "index.ts")
  ).href;
  const source = `
const url = ${JSON.stringify(indexUrl)};
try {
	await import(url);
	console.log("ATHENA_ROOT_IMPORT=ok");
	process.exit(0);
} catch (error) {
	const text = error instanceof Error ? error.message : String(error);
	console.error(text);
	process.exit(1);
}
`;
  const probe = useBuiltRoot
    ? spawnPlainNode(["--input-type=module", "--eval", source])
    : spawnPlainTs(source);
  assert.equal(probe.status, 0, probe.combined);
  assert.match(probe.stdout, /ATHENA_ROOT_IMPORT=ok/);
  assertNotServerOnlyPoison(probe.combined, "T-01");
});

test("T-02: P?: athena.config.ts can import defineAthenaConfig and generatorEnv from public root", () => {
  const fixture = writeRootHelperFixture();
  try {
    const loadUrl = pathToFileURL(join(srcRoot, "generator", "config.ts")).href;
    const probe = spawnPlainTs(`
import { loadAthenaConfig, loadGeneratorConfig } from ${JSON.stringify(loadUrl)};

const cwd = ${JSON.stringify(fixture.cwd)};
const outcomes: Record<string, unknown> = {};
for (const [name, load] of [
	["loadAthenaConfig", loadAthenaConfig],
	["loadGeneratorConfig", loadGeneratorConfig],
] as const) {
	try {
		const loaded = await load({ cwd });
		outcomes[name] = {
			ok: true,
			kind: loaded.config.provider?.kind ?? null,
		};
	} catch (error) {
		outcomes[name] = {
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
console.log("BOUNDARY_LOAD=" + JSON.stringify(outcomes));
`);
    assert.equal(probe.status, 0, probe.combined);
    const payload = jsonLine<{
      loadAthenaConfig?: { error?: string; kind?: string; ok?: boolean };
      loadGeneratorConfig?: { error?: string; kind?: string; ok?: boolean };
    }>(probe.stdout, "BOUNDARY_LOAD=");
    assert.equal(
      payload.loadAthenaConfig?.ok,
      true,
      String(payload.loadAthenaConfig?.error)
    );
    assert.equal(
      payload.loadGeneratorConfig?.ok,
      true,
      String(payload.loadGeneratorConfig?.error)
    );
    assert.equal(payload.loadAthenaConfig?.kind, "postgres");
    assert.equal(payload.loadGeneratorConfig?.kind, "postgres");
    assertNotServerOnlyPoison(JSON.stringify(payload), "T-02");
    const nextMinimalConfig = readFileSync(
      join(
        pkgRoot,
        "..",
        "athena-auth-ui",
        "examples",
        "next-minimal",
        "athena.config.ts"
      ),
      "utf8"
    );
    assert.match(
      nextMinimalConfig,
      /from ["']@xylex-group\/athena["']/,
      "next-minimal must keep defineAthenaConfig from the public root"
    );
    assert.match(nextMinimalConfig, /\bdefineAthenaConfig\b/);
    assert.match(nextMinimalConfig, /\bgeneratorEnv\b/);
    assert.doesNotMatch(
      nextMinimalConfig,
      /@xylex-group\/athena\/config/,
      "do not workaround via @xylex-group/athena/config"
    );
  } finally {
    fixture.cleanup();
  }
});

test("T-02b: P?: compiled loadAthenaConfig loads .ts config without --import tsx", (t) => {
  const distIndex = join(distRoot, "index.js");
  if (!existsSync(distIndex)) {
    t.skip("dist/index.js is not built");
    return;
  }
  const fixture = writeRootHelperFixture("dist");
  try {
    const distUrl = pathToFileURL(distIndex).href;
    const probe = spawnPlainNode(
      [
        "--input-type=module",
        "--eval",
        `import { loadAthenaConfig } from ${JSON.stringify(distUrl)};
const loaded = await loadAthenaConfig({ cwd: ${JSON.stringify(fixture.cwd)} });
console.log("TS_CONFIG_LOAD=" + (loaded.config.provider?.kind ?? "missing"));
`,
      ],
      fixture.cwd
    );
    assert.equal(probe.status, 0, probe.combined);
    assert.match(probe.stdout, /TS_CONFIG_LOAD=postgres/);
    assertNotServerOnlyPoison(probe.combined, "T-02b");
  } finally {
    fixture.cleanup();
  }
});

test("T-03: P?: CLI graph has no server-only next/server headers navigation or public server entries", () => {
  const hits = collectCliHits(join(srcRoot, "cli"));
  if (existsSync(join(distRoot, "cli"))) {
    hits.push(...collectCliHits(join(distRoot, "cli")));
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("T-04: P?: server-only remains only on public framework entrypoints", () => {
  const hits: string[] = [];
  for (const file of collectFiles(srcRoot, ".ts")) {
    const source = readFileSync(file, "utf8");
    if (
      !(
        /^[ \t]*import[ \t]+["']server-only["']/m.test(source) ||
        /\bfrom\s+["']server-only["']/.test(source)
      )
    ) {
      continue;
    }
    const rel = srcRel(file);
    if (!SERVER_ONLY_ALLOWLIST.has(rel)) {
      hits.push(rel);
    }
  }
  assert.deepEqual(
    hits,
    [],
    `server-only must stay on public edges only; extra: ${hits.join(", ")}`
  );
  for (const allowed of SERVER_ONLY_ALLOWLIST) {
    assert.equal(
      existsSync(join(srcRoot, allowed)),
      true,
      `missing allowlisted edge ${allowed}`
    );
    assert.match(
      readSrc(allowed),
      /import ["']server-only["']/,
      `${allowed} must keep import "server-only"`
    );
  }
  assert.doesNotMatch(
    readSrc("runtime/authority/resolve.ts"),
    /^import ["']server-only["']/m
  );
});

test("T-05: P?: runtime generator migrations auth/local postgres schema and cli have no server-only", () => {
  const hits: string[] = [];
  for (const dir of SERVER_ONLY_FORBIDDEN_DIRS) {
    for (const file of collectFiles(join(srcRoot, dir), ".ts")) {
      const source = readFileSync(file, "utf8");
      if (
        /^[ \t]*import[ \t]+["']server-only["']/m.test(source) ||
        /\bfrom\s+["']server-only["']/.test(source)
      ) {
        hits.push(srcRel(file));
      }
    }
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("T-06: P?: validateLocalRuntime evaluates Generator config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const validateUrl = pathToFileURL(
      join(srcRoot, "cli", "commands", "validate", "validate-local.ts")
    ).href;
    const probe = spawnPlainTs(`
import { validateLocalRuntime } from ${JSON.stringify(validateUrl)};

const report = await validateLocalRuntime({ cwd: ${JSON.stringify(fixture.cwd)} });
console.log("BOUNDARY_REPORT=" + JSON.stringify(report));
`);
    assert.match(probe.stdout, /BOUNDARY_REPORT=/);
    const report = jsonLine<{
      checks: Array<{
        detail?: string;
        id: string;
        status?: string;
        title: string;
      }>;
      ok: boolean;
    }>(probe.stdout, "BOUNDARY_REPORT=");
    const blob = JSON.stringify(report);
    assertNotServerOnlyPoison(blob, "T-06");
    const configCheck = report.checks.find(
      (check) => check.id === "data.config"
    );
    assert.equal(configCheck?.title, "Generator config");
    assert.notEqual(configCheck?.status, "error", configCheck?.detail);
    if (!report.ok) {
      assert.equal(
        report.checks.some((check) => check.id === "data.connect"),
        true,
        "failure after config eval may be data.connect only"
      );
      assert.match(
        report.checks.find((check) => check.id === "data.connect")?.detail ??
        blob,
        CONNECT_REFUSED
      );
    }
  } finally {
    fixture.cleanup();
  }
});

test("T-07: P?: inspectLocalAuthStatus evaluates config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const inspectUrl = pathToFileURL(
      join(srcRoot, "cli", "commands", "auth", "inspect-local.ts")
    ).href;
    const probe = spawnPlainTs(`
import { inspectLocalAuthStatus } from ${JSON.stringify(inspectUrl)};

try {
	await inspectLocalAuthStatus({ cwd: ${JSON.stringify(fixture.cwd)} });
	console.log("BOUNDARY_INSPECT=ok");
	process.exit(0);
} catch (error) {
	const text = error instanceof Error ? error.message : String(error);
	console.log("BOUNDARY_INSPECT_ERROR=" + text);
	process.exit(2);
}
`);
    assertNotServerOnlyPoison(probe.combined, "T-07");
    if (probe.status !== 0) {
      assert.match(probe.stdout, /BOUNDARY_INSPECT_ERROR=/);
      const line = probe.stdout
        .split(/\r?\n/)
        .find((entry) => entry.startsWith("BOUNDARY_INSPECT_ERROR="));
      if (line === undefined) {
        assert.fail("missing BOUNDARY_INSPECT_ERROR=");
      }
      const message = line.slice("BOUNDARY_INSPECT_ERROR=".length);
      assert.match(message, CONNECT_REFUSED);
    }
  } finally {
    fixture.cleanup();
  }
});

test("T-08: P?: generate evaluates config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const generateUrl = pathToFileURL(
      join(srcRoot, "generator", "pipeline.ts")
    ).href;
    const probe = spawnPlainTs(`
import { runSchemaGenerator } from ${JSON.stringify(generateUrl)};

try {
	await runSchemaGenerator({
		cwd: ${JSON.stringify(fixture.cwd)},
		discoverSchemas: false,
		dryRun: true,
		writeConfig: false,
	});
	console.log("BOUNDARY_GENERATE=ok");
	process.exit(0);
} catch (error) {
	const text = error instanceof Error ? error.message : String(error);
	console.log("BOUNDARY_GENERATE_ERROR=" + text);
	process.exit(2);
}
`);
    assertNotServerOnlyPoison(probe.combined, "T-08");
    assert.match(probe.stdout, /BOUNDARY_GENERATE(?:=ok|_ERROR=)/);
    if (probe.status !== 0) {
      assert.match(probe.stdout, CONNECT_REFUSED);
    }
  } finally {
    fixture.cleanup();
  }
});

test("T-09: P?: migrate status evaluates config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const prepareUrl = pathToFileURL(
      join(srcRoot, "migrations", "application", "prepare.ts")
    ).href;
    const probe = spawnPlainTs(`
import { prepareApplicationMigrationRun } from ${JSON.stringify(prepareUrl)};

try {
	await prepareApplicationMigrationRun({
		cwd: ${JSON.stringify(fixture.cwd)},
		dryRun: true,
		mode: "status",
		plain: true,
	});
	console.log("BOUNDARY_MIGRATE=ok");
	process.exit(0);
} catch (error) {
	const text = error instanceof Error ? error.message : String(error);
	console.log("BOUNDARY_MIGRATE_ERROR=" + text);
	process.exit(2);
}
`);
    assertNotServerOnlyPoison(probe.combined, "T-09");
    assert.match(probe.stdout, /BOUNDARY_MIGRATE=/);
  } finally {
    fixture.cleanup();
  }
});

test("T-10: P?: doctor evaluates config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const doctorUrl = pathToFileURL(
      join(srcRoot, "cli", "commands", "doctor", "doctor.ts")
    ).href;
    const probe = spawnPlainTs(`
import { runCliDoctor } from ${JSON.stringify(doctorUrl)};

const report = await runCliDoctor({
	cwd: ${JSON.stringify(fixture.cwd)},
	plain: true,
	skipRuntime: false,
});
console.log("BOUNDARY_DOCTOR=" + JSON.stringify(report));
`);
    assert.match(probe.stdout, /BOUNDARY_DOCTOR=/);
    const report = jsonLine<{
      checks: Array<{
        detail?: string;
        id: string;
        status?: string;
        title: string;
      }>;
    }>(probe.stdout, "BOUNDARY_DOCTOR=");
    const blob = JSON.stringify(report);
    assertNotServerOnlyPoison(blob, "T-10");
    const runtime = report.checks.filter((check) =>
      check.id.startsWith("runtime.")
    );
    assert.equal(
      runtime.length > 0,
      true,
      "doctor must inspect runtime (not skip)"
    );
    const configPoison = runtime.find((check) =>
      SERVER_ONLY_POISON.test(check.detail ?? "")
    );
    assert.equal(configPoison, undefined, configPoison?.detail);
  } finally {
    fixture.cleanup();
  }
});

test("T-11: P?: policy load evaluates config without Client Component error", () => {
  const fixture = writeRootHelperFixture();
  try {
    const policyUrl = pathToFileURL(
      join(srcRoot, "cli", "commands", "policy", "load.ts")
    ).href;
    const probe = spawnPlainTs(`
import { loadPolicyDocument } from ${JSON.stringify(policyUrl)};

try {
	const loaded = await loadPolicyDocument({ cwd: ${JSON.stringify(fixture.cwd)} });
	console.log("BOUNDARY_POLICY=" + JSON.stringify({
		ok: true,
		kind: loaded.config.provider?.kind ?? null,
		policyCount: loaded.document.policies?.length ?? 0,
	}));
	process.exit(0);
} catch (error) {
	const text = error instanceof Error ? error.message : String(error);
	console.log("BOUNDARY_POLICY=" + JSON.stringify({ ok: false, error: text }));
	process.exit(2);
}
`);
    const payload = jsonLine<{ error?: string; kind?: string; ok?: boolean }>(
      probe.stdout,
      "BOUNDARY_POLICY="
    );
    assertNotServerOnlyPoison(JSON.stringify(payload), "T-11");
    assert.equal(payload.ok, true, payload.error);
    assert.equal(payload.kind, "postgres");
  } finally {
    fixture.cleanup();
  }
});

test("T-12: P?: Node-local createClient retains pg Embedded Auth local billing and storage", () => {
  const v3 = readSrc("v3-client.ts");
  const indexSrc = readSrc("index.ts");
  assert.match(v3, /from ["']\.\/postgres\/owned-runtime\.ts["']/);
  assert.match(v3, /createAthenaPostgresRuntime/);
  assert.match(v3, /from ["']\.\/auth\/local\/runtime\.ts["']/);
  assert.match(v3, /bootstrapLocalBillingRuntime/);
  assert.match(v3, /createStorageRuntime/);
  assert.match(
    indexSrc,
    /export \{ AthenaConfigurationError, createClient \} from ["']\.\/v3-client\.ts["']/
  );
  assert.doesNotMatch(
    indexSrc,
    /export \{[^}]*createClient[^}]*\} from ["']\.\/browser\.ts["']/
  );
});

test("T-13: P?: loadAthenaConfig and loadGeneratorConfig do not instantiate runtimes", () => {
  const configSrc = readSrc("generator/config.ts");
  assert.doesNotMatch(configSrc, /\bcreateClient\s*\(/);
  assert.doesNotMatch(configSrc, /\bmaterializeRuntimePlan\b/);
  assert.doesNotMatch(configSrc, /\bcreateAthenaPostgresRuntime\b/);
  assert.doesNotMatch(configSrc, /\bfrom ["']pg["']/);
  assert.doesNotMatch(configSrc, /new\s+Pool\b/);
});

test("T-14: P?: browser Next client and RN graphs stay free of server-only and Node materializers", () => {
  const surfaces = [
    ["browser.ts", readSrc("browser.ts")],
    ["next/client.ts", readSrc("next/client.ts")],
    ...collectFiles(join(srcRoot, "react-native"), ".ts").map(
      (file) => [srcRel(file), readFileSync(file, "utf8")] as const
    ),
  ] as const;
  for (const [name, src] of surfaces) {
    assert.doesNotMatch(src, SERVER_ONLY_IMPORT_RE, name);
    assert.doesNotMatch(src, /from ["'][^"']*\/v3-client\.ts["']/, name);
    assert.doesNotMatch(
      src,
      /from ["'][^"']*auth\/local\/(?:runtime|database)\.ts["']/,
      name
    );
    assert.doesNotMatch(
      src,
      /from ["'][^"']*runtime\/authority\/(?:resolve|index)\.ts["']/,
      name
    );
  }
});

test("T-15: P?: packed ESM createClient runs without server-only stub", () => {
  const distEsm = join(distRoot, "index.js");
  assert.equal(
    existsSync(distEsm),
    true,
    "dist/index.js required (run pnpm build)"
  );
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-boundary-esm-"));
  const probeFile = join(dir, "esm-probe.mjs");
  writeFileSync(
    probeFile,
    `import { createClient } from ${JSON.stringify(pathToFileURL(distEsm).href)};
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("ESM createClient missing from()");
console.log("packed-esm:ok");
`,
    "utf8"
  );
  try {
    const probe = spawnPlainNode([probeFile], pkgRoot);
    assert.equal(probe.status, 0, probe.combined);
    assert.match(probe.stdout, /packed-esm:ok/);
    assertNotServerOnlyPoison(probe.combined, "T-15");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
  const tarball = readFileSync(
    join(pkgRoot, "scripts", "check-release-tarball.mjs"),
    "utf8"
  );
  assert.doesNotMatch(
    tarball,
    /Root and \.\/server graphs import ["']server-only["']/
  );
  const esmExec = tarball.slice(
    tarball.indexOf("esm-probe.mjs"),
    tarball.indexOf("cjs-probe.cjs")
  );
  assert.equal(
    esmExec.includes("serverOnlyRegister"),
    false,
    "packed ESM probe must not --import the server-only stub"
  );
});

test("T-16: P?: packed CJS createClient runs without server-only stub", () => {
  const distCjs = join(distRoot, "index.cjs");
  assert.equal(
    existsSync(distCjs),
    true,
    "dist/index.cjs required (run pnpm build)"
  );
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-boundary-cjs-"));
  const probeFile = join(dir, "cjs-probe.cjs");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ type: "commonjs" })}\n`,
    "utf8"
  );
  writeFileSync(
    probeFile,
    `const { createClient } = require(${JSON.stringify(distCjs)});
const client = createClient({ url: "https://athena.example.com", key: "publishable", auth: false });
if (typeof client.from !== "function") throw new Error("CJS createClient missing from()");
console.log("packed-cjs:ok");
`,
    "utf8"
  );
  try {
    const probe = spawnPlainNode([probeFile], pkgRoot);
    assert.equal(probe.status, 0, probe.combined);
    assert.match(probe.stdout, /packed-cjs:ok/);
    assertNotServerOnlyPoison(probe.combined, "T-16");
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
  const tarball = readFileSync(
    join(pkgRoot, "scripts", "check-release-tarball.mjs"),
    "utf8"
  );
  const cjsExec = tarball.slice(
    tarball.indexOf("cjs-probe.cjs"),
    tarball.indexOf("rn-probe.mjs")
  );
  assert.equal(
    cjsExec.includes("serverOnlyRegister"),
    false,
    "packed CJS probe must not --import the server-only stub"
  );
});

test("T-17: P?: audit-runtime-boundaries forbids server-only on root and CLI build output", () => {
  const auditPath = join(pkgRoot, "scripts", "audit-runtime-boundaries.mjs");
  assert.equal(
    existsSync(auditPath),
    true,
    "scripts/audit-runtime-boundaries.mjs"
  );
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    scripts?: Record<string, string>;
  };
  assert.match(
    pkg.scripts?.["check:release"] ?? "",
    /audit-runtime-boundaries/
  );
  assert.match(
    pkg.scripts?.["check:release"] ?? "",
    /test-package-node-import/
  );
  assert.equal(
    existsSync(join(pkgRoot, "scripts", "test-package-node-import.mjs")),
    true,
    "scripts/test-package-node-import.mjs"
  );

  function assertNoServerOnly(rel: string): void {
    const file = join(pkgRoot, rel);
    assert.equal(existsSync(file), true, rel);
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      SERVER_ONLY_IMPORT_RE,
      `${rel} must not contain server-only`
    );
  }
  function assertHasServerOnly(rel: string): void {
    const file = join(pkgRoot, rel);
    assert.equal(existsSync(file), true, rel);
    assert.match(
      readFileSync(file, "utf8"),
      SERVER_ONLY_IMPORT_RE,
      `${rel} must keep server-only`
    );
  }

  assertNoServerOnly("dist/index.js");
  assertNoServerOnly("dist/index.cjs");
  for (const file of collectFiles(join(distRoot, "cli"), ".js").concat(
    collectFiles(join(distRoot, "cli"), ".cjs")
  )) {
    assert.doesNotMatch(
      readFileSync(file, "utf8"),
      SERVER_ONLY_IMPORT_RE,
      posix(relative(pkgRoot, file))
    );
  }
  assertHasServerOnly("dist/server.js");
  assertHasServerOnly("dist/next/server.js");
  assertHasServerOnly("dist/email/node.js");
});
