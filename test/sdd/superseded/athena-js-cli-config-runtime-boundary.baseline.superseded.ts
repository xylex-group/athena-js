/**
 * SUPERSEDED by test/sdd/athena-js-cli-config-runtime-boundary.target.test.ts
 *
 * Former characterization of the defect: public root `src/index.ts` →
 * `v3-client.ts` reached `runtime/authority/resolve.ts` which
 * `import "server-only"`. Plain Node threw Client Component; config load
 * and CLI validate/auth inspect died before Postgres. Target suite is the
 * CI source of truth (ADR 0064). Not collected by pnpm test (superseded/).
 *
 * See docs/sdd/xylex/athena-js-cli-config-runtime-boundary/
 */

import { strict as assert } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
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
const pkgRoot = join(here, "..", "..", "..");
const srcRoot = join(pkgRoot, "src");
const nextMinimalConfig = join(
  pkgRoot,
  "..",
  "athena-auth-ui",
  "examples",
  "next-minimal",
  "athena.config.ts"
);

const SERVER_ONLY_POISON =
  /Client Component|server-only|should only be used from a Server Component/i;
const NOT_FOUND_CONFIG = /No (Athena|generator) config found/i;
const CONNECT_REFUSED = /ECONNREFUSED|connect ECONNREFUSED|AUTH001/i;

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
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
  return env;
}

function spawnPlainTs(source: string): {
  status: number | null;
  stdout: string;
  stderr: string;
  combined: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "athena-cli-boundary-probe-"));
  const file = join(dir, "probe.ts");
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ type: "module" })}\n`,
    "utf8"
  );
  writeFileSync(file, source, "utf8");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", file], {
      cwd: pkgRoot,
      encoding: "utf8",
      env: childEnv(),
      timeout: 90_000,
      windowsHide: true,
    });
    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    return {
      combined: `${stdout}\n${stderr}`,
      status: result.status,
      stderr,
      stdout,
    };
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
}

function writeRootHelperFixture(): { cwd: string; cleanup: () => void } {
  const cwd = mkdtempSync(join(tmpdir(), "athena-cli-boundary-fixture-"));
  const shimDir = join(cwd, "node_modules", "@xylex-group", "athena");
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(
    join(shimDir, "package.json"),
    `${JSON.stringify({
      exports: { ".": "./index.ts" },
      name: "@xylex-group/athena",
      type: "module",
    })}\n`,
    "utf8"
  );
  const indexUrl = pathToFileURL(join(srcRoot, "index.ts")).href;
  writeFileSync(
    join(shimDir, "index.ts"),
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

function assertServerOnlyPoison(text: string, label: string): void {
  assert.match(text, SERVER_ONLY_POISON, `${label}: ${text}`);
  assert.doesNotMatch(
    text,
    NOT_FOUND_CONFIG,
    `${label} must not be missing-config: ${text}`
  );
}

test("B-01: P?: native Node root encounters server-only-reachable graph", () => {
  const indexSrc = readSrc("index.ts");
  const resolveSrc = readSrc("runtime/authority/resolve.ts");
  const chatMaterializerSrc = readSrc("runtime/materializers/chat.ts");
  const chatPrincipalSrc = readSrc("chat/local/principal.ts");

  assert.match(
    indexSrc,
    /export \{ AthenaConfigurationError, createClient \} from ["']\.\/v3-client\.ts["']/
  );
  assert.match(resolveSrc, /^import ["']server-only["']/m);
  assert.match(chatMaterializerSrc, /createRootChatPrincipalResolver/);
  assert.match(
    chatPrincipalSrc,
    /from ["']\.\.\/\.\.\/runtime\/authority\/index\.ts["']/
  );

  const indexUrl = pathToFileURL(join(srcRoot, "index.ts")).href;
  const probe = spawnPlainTs(`
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
`);

  assert.notEqual(probe.status, 0, probe.combined);
  assertServerOnlyPoison(probe.combined, "B-01 child import");
  assert.equal(probe.combined.includes("ATHENA_ROOT_IMPORT=ok"), false);
});

test("B-02: P?: config with root helpers cannot load", () => {
  const fixture = writeRootHelperFixture();
  try {
    const loadAthenaUrl = pathToFileURL(
      join(srcRoot, "generator", "config.ts")
    ).href;
    const probe = spawnPlainTs(`
import { loadAthenaConfig, loadGeneratorConfig } from ${JSON.stringify(loadAthenaUrl)};

const cwd = ${JSON.stringify(fixture.cwd)};
const outcomes: Record<string, string> = {};
for (const [name, load] of [
	["loadAthenaConfig", loadAthenaConfig],
	["loadGeneratorConfig", loadGeneratorConfig],
] as const) {
	try {
		await load({ cwd });
		outcomes[name] = "ok";
	} catch (error) {
		outcomes[name] = error instanceof Error ? error.message : String(error);
	}
}
console.log("BOUNDARY_LOAD=" + JSON.stringify(outcomes));
`);

    assert.match(probe.stdout, /BOUNDARY_LOAD=/);
    const line = probe.stdout
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("BOUNDARY_LOAD="));
    assert.equal(typeof line, "string");
    const payload = JSON.parse(line.slice("BOUNDARY_LOAD=".length)) as {
      loadAthenaConfig?: string;
      loadGeneratorConfig?: string;
    };
    assert.equal(typeof payload.loadAthenaConfig, "string");
    assert.equal(typeof payload.loadGeneratorConfig, "string");
    assert.notEqual(payload.loadAthenaConfig, "ok");
    assert.notEqual(payload.loadGeneratorConfig, "ok");
    assertServerOnlyPoison(payload.loadAthenaConfig ?? "", "loadAthenaConfig");
    assertServerOnlyPoison(
      payload.loadGeneratorConfig ?? "",
      "loadGeneratorConfig"
    );
  } finally {
    fixture.cleanup();
  }
});

test("B-03: P?: validateLocalRuntime fails at Generator config", () => {
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
    const line = probe.stdout
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("BOUNDARY_REPORT="));
    assert.equal(typeof line, "string");
    const report = JSON.parse(line.slice("BOUNDARY_REPORT=".length)) as {
      checks: Array<{ detail?: string; id: string; title: string }>;
      ok: boolean;
    };
    assert.equal(report.ok, false);
    const configCheck = report.checks.find(
      (check) => check.id === "data.config"
    );
    assert.equal(configCheck?.title, "Generator config");
    assert.equal(typeof configCheck?.detail, "string");
    assertServerOnlyPoison(configCheck?.detail ?? "", "data.config");
    assert.equal(
      report.checks.some((check) => check.id === "data.connect"),
      false,
      "must fail at Generator config before data.connect"
    );
    assert.doesNotMatch(configCheck?.detail ?? "", CONNECT_REFUSED);
  } finally {
    fixture.cleanup();
  }
});

test("B-04: P?: inspectLocalAuthStatus fails resolving config", () => {
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

    assert.notEqual(probe.status, 0, probe.combined);
    assert.equal(probe.combined.includes("BOUNDARY_INSPECT=ok"), false);
    assert.match(probe.stdout, /BOUNDARY_INSPECT_ERROR=/);
    const line = probe.stdout
      .split(/\r?\n/)
      .find((entry) => entry.startsWith("BOUNDARY_INSPECT_ERROR="));
    assert.equal(typeof line, "string");
    const message = line.slice("BOUNDARY_INSPECT_ERROR=".length);
    assertServerOnlyPoison(message, "inspectLocalAuthStatus");
    assert.doesNotMatch(message, CONNECT_REFUSED);
    assert.doesNotMatch(message, /postgres protocol|password authentication/i);
  } finally {
    fixture.cleanup();
  }
});

test("B-05: P?: next-minimal athena.config.ts uses public root helpers", () => {
  const source = readFileSync(nextMinimalConfig, "utf8");
  assert.match(
    source,
    /import \{ defineAthenaConfig, generatorEnv \} from ["']@xylex-group\/athena["']/
  );
});
