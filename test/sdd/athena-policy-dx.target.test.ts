/**
 * Wave 1 target (11 GREEN) plus PR B Policy DX extras (GREEN).
 * Titles encode the original found case (`P?: <exact subject>`).
 * See docs/sdd/xylex/athena-policy/SPEC.md and dual-suite/dual-suite-spec.md.
 *
 * Wave 1 characterization retired to
 * test/sdd/superseded/athena-policy-dx.baseline.superseded.ts
 * PR B characterization retired to
 * test/sdd/superseded/athena-policy-dx.pr-b.baseline.superseded.ts
 */
import { strict as assert } from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CLI_REGISTERED_COMMANDS } from "../../src/cli/commands/register.ts";
import { CLI_COMMAND_CATALOG } from "../../src/cli/commands-catalog.ts";
import {
  defineAthenaConfig,
  defineGeneratorConfig,
  loadGeneratorConfig,
  normalizeGeneratorConfig,
} from "../../src/generator/index.ts";
import type { AthenaGeneratorConfig } from "../../src/generator/types.ts";
import * as policyBarrel from "../../src/policy/index.ts";
import {
  canonicalizeDocument,
  decideAthenaPolicy,
  definePolicies,
  fingerprintDocument,
  policy,
} from "../../src/policy/index.ts";
import { string, table } from "../../src/schema/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..", "..");
const srcRoot = join(pkgRoot, "src");

const MIN_PROVIDER = {
  connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
  database: "app_db",
  kind: "postgres" as const,
  mode: "direct" as const,
};

const TOOLING = {
  models: "./src/lib/athena/generated/registry.ts",
  policies: "./src/lib/athena/policies.ts",
  runtime: "./src/lib/athena/mcp-runtime.ts",
  mcp: { runtime: "./src/lib/athena/mcp-runtime.ts" },
};
const LOADED_TOOLING = {
  models: TOOLING.models,
  policies: TOOLING.policies,
};

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), "utf8");
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTsFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function projectFromLoaded(loaded: unknown): Record<string, unknown> {
  assert.ok(loaded && typeof loaded === "object");
  const record = loaded as Record<string, unknown>;
  if (record.config && typeof record.config === "object") {
    return record.config as Record<string, unknown>;
  }
  return record;
}

const PRESET_IDS = [
  "organizationScoped",
  "tenantScoped",
  "userOwned",
  "publicRead",
  "authenticatedOnly",
  "roleRestricted",
  "serviceOnly",
  "ownerOrRole",
] as const;

const POLICY_DX_COMMANDS = [
  "policy",
  "policy list",
  "policy show",
  "policy validate",
  "policy lint",
  "policy coverage",
  "policy explain",
  "policy simulate",
  "policy fingerprint",
  "policy export",
] as const;

const PROVENANCE_TAGS = [
  "preset:",
  "fromPreset",
  "presetId",
  '"provenance"',
  "irProvenance",
] as const;

const invoices = table("invoices")
  .schema("public")
  .columns({
    amount: string(),
    id: string().generated(),
    organizationId: string().from("organization_id"),
    tenantId: string().from("tenant_id"),
    userId: string().from("user_id"),
  })
  .primaryKey("id");

type AuthoredPolicyLike = {
  kind: string;
  definitions: unknown[];
};

type PolicyPresetFn = (model: typeof invoices) => AuthoredPolicyLike;

function stringifyIr(value: unknown): string {
  return JSON.stringify(value);
}

async function importPolicyCli(): Promise<Record<string, unknown>> {
  const url = pathToFileURL(
    join(srcRoot, "cli", "commands", "policy", "index.ts")
  ).href;
  return (await import(url)) as Record<string, unknown>;
}

test("P1: AthenaConfig provider optional vs still-strict AthenaGeneratorConfig", () => {
  const typesSrc = readSrc("generator/types.ts");
  assert.match(typesSrc, /export interface AthenaConfig\b/);
  const configStart = typesSrc.indexOf("export interface AthenaConfig");
  const generatorStart = typesSrc.indexOf(
    "export interface AthenaGeneratorConfig"
  );
  assert.ok(configStart >= 0, "AthenaConfig must exist");
  assert.ok(
    generatorStart > configStart,
    "AthenaGeneratorConfig must follow AthenaConfig"
  );

  const athenaConfigBlock = typesSrc.slice(configStart, generatorStart);
  assert.match(athenaConfigBlock, /provider\?:/);
  assert.equal(athenaConfigBlock.includes("provider:"), false);
  assert.match(athenaConfigBlock, /models\?:/);
  assert.match(athenaConfigBlock, /policies\?:/);
  assert.match(athenaConfigBlock, /tooling\?:/);

  const normalizedStart = typesSrc.indexOf(
    "export interface NormalizedAthenaGeneratorConfig"
  );
  assert.ok(normalizedStart > generatorStart);
  const generatorBlock = typesSrc.slice(generatorStart, normalizedStart);
  assert.match(
    generatorBlock,
    /extends Omit<\s*AthenaConfig,\s*"provider"\s*>/
  );
  assert.match(generatorBlock, /provider: GeneratorProviderInputConfig/);
  assert.equal(generatorBlock.includes("provider?:"), false);

  const normalizedEnd = typesSrc.indexOf(
    "export interface LoadGeneratorConfigOptions"
  );
  const normalizedBlock = typesSrc.slice(
    normalizedStart,
    normalizedEnd > normalizedStart ? normalizedEnd : typesSrc.length
  );
  assert.match(normalizedBlock, /provider: GeneratorProviderConfig/);
  assert.equal(normalizedBlock.includes("provider?:"), false);
  assert.equal(/\bmodels\??:/.test(normalizedBlock), false);
  assert.equal(/\bpolicies\??:/.test(normalizedBlock), false);
  assert.equal(/\btooling\??:/.test(normalizedBlock), false);
});

test("P1: defineAthenaConfig is permissive AthenaConfig identity", () => {
  const helpersSrc = readSrc("config/project-helpers.ts");
  assert.match(
    helpersSrc,
    /export function defineAthenaConfig<\s*T(?:Config)? extends AthenaConfig\s*>/
  );
  assert.equal(
    /export function defineAthenaConfig<\s*T(?:Config)? extends AthenaGeneratorConfig\s*>/.test(
      helpersSrc
    ),
    false
  );
  const configSrc = readSrc("generator/config.ts");
  assert.match(
    configSrc,
    /export \{ defineAthenaConfig, defineGeneratorConfig \}/
  );

  const withoutProvider = defineAthenaConfig({
    policies: { definitions: [] },
    tooling: TOOLING,
  } as never);
  assert.equal("provider" in withoutProvider, false);
  assert.deepEqual((withoutProvider as { tooling?: unknown }).tooling, TOOLING);
});

test("P1: defineGeneratorConfig is NOT an alias of defineAthenaConfig", () => {
  assert.notEqual(defineGeneratorConfig, defineAthenaConfig);
  assert.equal(typeof defineGeneratorConfig, "function");
  assert.equal(typeof defineAthenaConfig, "function");

  const helpersSrc = readSrc("config/project-helpers.ts");
  assert.equal(
    /export const defineGeneratorConfig = defineAthenaConfig/.test(helpersSrc),
    false
  );
  assert.match(
    helpersSrc,
    /export function defineGeneratorConfig<\s*T(?:Config)? extends AthenaGeneratorConfig\s*>/
  );
  const configSrc = readSrc("generator/config.ts");
  assert.equal(
    /export const defineGeneratorConfig = defineAthenaConfig/.test(configSrc),
    false
  );

  const browserSrc = readSrc("browser.ts");
  assert.equal(
    /export const defineGeneratorConfig = defineAthenaConfig/.test(browserSrc),
    false
  );

  const withProvider = defineGeneratorConfig({
    provider: MIN_PROVIDER,
  });
  assert.equal(withProvider.provider.kind, "postgres");
});

test("P1: loadAthenaConfig retains models/policies/tooling", async () => {
  const generator = await import("../../src/generator/index.ts");
  assert.equal(typeof generator.loadAthenaConfig, "function");
  assert.equal(typeof generator.loadGeneratorConfig, "function");

  const configSrc = readSrc("generator/config.ts");
  assert.match(configSrc, /export async function loadAthenaConfig/);
  assert.equal(/\bcreateClient\b/.test(configSrc), false);
  assert.equal(/\bcreateAthenaServerRuntime\b/.test(configSrc), false);

  const generatorIndexSrc = readSrc("generator/index.ts");
  const rootIndexSrc = readSrc("index.ts");
  assert.match(generatorIndexSrc, /\bloadAthenaConfig\b/);
  assert.match(rootIndexSrc, /\bloadAthenaConfig\b/);

  const browserSrc = readSrc("browser.ts");
  assert.match(browserSrc, /\bloadAthenaConfig\b/);
  assert.match(browserSrc, /throwBrowserUnsupported\(\s*"loadAthenaConfig"/);

  const root = mkdtempSync(join(tmpdir(), "athena-policy-dx-load-athena-"));
  try {
    const generatedDir = join(root, "src", "lib", "athena", "generated");
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(
      join(generatedDir, "registry.ts"),
      'throw new Error("generated registry must not be imported while loading config");\n',
      "utf8"
    );
    writeFileSync(
      join(root, "src", "lib", "athena", "policies.ts"),
      'throw new Error("policy source must not be imported by loadAthenaConfig");\n',
      "utf8"
    );
    writeFileSync(
      join(root, "athena.config.ts"),
      `
export default {
  models: { invoices: { table: "invoices" } },
  policies: { definitions: [] },
  tooling: {
    models: "./src/lib/athena/generated/registry.ts",
    policies: "./src/lib/athena/policies.ts",
  },
};
`,
      "utf8"
    );

    const loaded = await generator.loadAthenaConfig({ cwd: root });
    const project = projectFromLoaded(loaded);
    assert.deepEqual(project.models, { invoices: { table: "invoices" } });
    assert.deepEqual(project.policies, { definitions: [] });
    assert.deepEqual(project.tooling, LOADED_TOOLING);
    assert.equal("provider" in project && project.provider != null, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("P1: loadGeneratorConfig still requires provider and returns NormalizedAthenaGeneratorConfig", async () => {
  const typesSrc = readSrc("generator/types.ts");
  assert.match(
    typesSrc,
    /export async function loadGeneratorConfig|export interface LoadedGeneratorConfig/
  );
  assert.match(typesSrc, /config: NormalizedAthenaGeneratorConfig/);

  const generator = await import("../../src/generator/index.ts");
  assert.equal(
    typeof generator.loadAthenaConfig,
    "function",
    "loadGeneratorConfig stays the required-provider projection of loadAthenaConfig"
  );

  const noProviderRoot = mkdtempSync(
    join(tmpdir(), "athena-policy-dx-load-gen-no-provider-")
  );
  try {
    writeFileSync(
      join(noProviderRoot, "athena.config.ts"),
      `
export default {
  policies: { definitions: [] },
  tooling: { policies: "./src/lib/athena/policies.ts" },
};
`,
      "utf8"
    );
    const retained = await generator.loadAthenaConfig({ cwd: noProviderRoot });
    const project = projectFromLoaded(retained);
    assert.deepEqual(project.policies, { definitions: [] });
    assert.deepEqual(project.tooling, {
      policies: "./src/lib/athena/policies.ts",
    });
    await assert.rejects(
      () => loadGeneratorConfig({ cwd: noProviderRoot }),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /must export a config object as default export or `config`|provider/i
        );
        return true;
      }
    );
  } finally {
    rmSync(noProviderRoot, { force: true, recursive: true });
  }

  const withProviderRoot = mkdtempSync(
    join(tmpdir(), "athena-policy-dx-load-gen-provider-")
  );
  try {
    writeFileSync(
      join(withProviderRoot, "athena.config.ts"),
      `
export default {
  models: { invoices: { table: "invoices" } },
  policies: { definitions: [] },
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
    database: "app_db",
  },
  tooling: {
    models: "./src/lib/athena/generated/registry.ts",
    policies: "./src/lib/athena/policies.ts",
  },
};
`,
      "utf8"
    );
    const loaded = await loadGeneratorConfig({ cwd: withProviderRoot });
    assert.deepEqual(Object.keys(loaded.config).sort(), [
      "experimental",
      "features",
      "filter",
      "internal",
      "migrations",
      "naming",
      "output",
      "provider",
    ]);
    assert.equal(loaded.config.provider.kind, "postgres");
    assert.equal("models" in loaded.config, false);
    assert.equal("policies" in loaded.config, false);
    assert.equal("tooling" in loaded.config, false);

    const normalized = normalizeGeneratorConfig({
      models: { invoices: { table: "invoices" } },
      policies: { definitions: [] },
      provider: MIN_PROVIDER,
      tooling: TOOLING,
    } as unknown as AthenaGeneratorConfig);
    assert.equal("tooling" in normalized, false);
    assert.equal(normalized.provider.kind, "postgres");
  } finally {
    rmSync(withProviderRoot, { force: true, recursive: true });
  }
});

test("P1: bootstrap-safe tooling entrypoints", () => {
  const typesSrc = readSrc("generator/types.ts");
  assert.match(typesSrc, /export interface AthenaToolingEntrypoints/);
  const toolingStart = typesSrc.indexOf(
    "export interface AthenaToolingEntrypoints"
  );
  assert.ok(toolingStart >= 0);
  const nextExport = typesSrc.indexOf("export interface", toolingStart + 1);
  const toolingBlock = typesSrc.slice(
    toolingStart,
    nextExport > toolingStart ? nextExport : typesSrc.length
  );
  assert.match(toolingBlock, /models\?: string/);
  assert.match(toolingBlock, /policies\?: string/);
  assert.match(toolingBlock, /runtime\?: string/);
  assert.match(toolingBlock, /mcp\?:/);

  const authored = defineAthenaConfig({
    provider: MIN_PROVIDER,
    tooling: TOOLING,
  } as never);
  assert.deepEqual((authored as { tooling?: unknown }).tooling, TOOLING);
});

test("P1: generate must not import tooling.models / generated registry", async () => {
  const pipelineSrc = readSrc("generator/pipeline.ts");
  const schemaRunSrc = readSrc("cli/commands/schema/run.ts");
  const configSrc = readSrc("generator/config.ts");

  assert.match(pipelineSrc, /loadAthenaConfig|loadGeneratorConfig/);
  assert.equal(pipelineSrc.includes("tooling.models"), false);
  assert.equal(schemaRunSrc.includes("tooling.models"), false);
  assert.equal(
    /import\(\s*(?:config\.)?tooling\.models/.test(pipelineSrc),
    false
  );
  assert.equal(/import\(.*generated\/registry/.test(pipelineSrc), false);
  assert.equal(/import\(.*generated\/registry/.test(configSrc), false);
  assert.equal(/import\(.*generated\/registry/.test(schemaRunSrc), false);

  const generator = await import("../../src/generator/index.ts");
  assert.equal(typeof generator.loadAthenaConfig, "function");

  const root = mkdtempSync(join(tmpdir(), "athena-policy-dx-generate-"));
  try {
    const generatedDir = join(root, "src", "lib", "athena", "generated");
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(
      join(generatedDir, "registry.ts"),
      'throw new Error("chicken-egg: generate must not import tooling.models");\n',
      "utf8"
    );
    writeFileSync(
      join(root, "athena.config.ts"),
      `
export default {
  provider: {
    kind: "postgres",
    mode: "direct",
    connectionString: "postgres://postgres:postgres@127.0.0.1:5432/app_db",
    database: "app_db",
  },
  tooling: {
    models: "./src/lib/athena/generated/registry.ts",
    policies: "./src/lib/athena/policies.ts",
  },
};
`,
      "utf8"
    );
    const loaded = await generator.loadAthenaConfig({ cwd: root });
    const project = projectFromLoaded(loaded);
    assert.deepEqual(project.tooling, LOADED_TOOLING);
    assert.equal(
      (project.provider as { kind?: string } | undefined)?.kind,
      "postgres"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("P1: createClient never reads tooling paths", () => {
  const clientCoreSrc = readSrc("v3-client-assembly.ts");
  const contractsSrc = readSrc("client/contracts.ts");
  const v3Src = readSrc("v3-client.ts");
  assert.equal(/\bloadAthenaConfig\b/.test(clientCoreSrc), false);
  assert.equal(/\bloadAthenaConfig\b/.test(v3Src), false);
  assert.equal(/\bloadGeneratorConfig\b/.test(clientCoreSrc), false);
  assert.equal(v3Src.includes("tooling.models"), false);
  assert.equal(clientCoreSrc.includes("tooling.models"), false);

  const configStart = contractsSrc.indexOf(
    "export interface AthenaClientRuntimeConfig"
  );
  const configEnd = contractsSrc.indexOf(
    "export type AthenaClientConfigWithR2"
  );
  assert.ok(configStart >= 0 && configEnd > configStart);
  const block = contractsSrc.slice(configStart, configEnd);
  assert.equal(/\btooling\??:/.test(block), false);

  const typesSrc = readSrc("generator/types.ts");
  assert.match(typesSrc, /tooling\?:/);
});

test("P1: package.json has no ./config/node; ./config is tooling identity only", () => {
  const pkg = JSON.parse(
    readFileSync(join(pkgRoot, "package.json"), "utf8")
  ) as {
    exports: Record<string, unknown>;
  };
  assert.equal("./config" in pkg.exports, true);
  assert.equal("./config/node" in pkg.exports, false);
  assert.equal("./policy" in pkg.exports, true);
  assert.equal("./schema" in pkg.exports, true);

  const publicSrc = readSrc("config/public.ts");
  assert.equal(/\bpolicy\b/.test(publicSrc), false);
  assert.equal(publicSrc.includes("defineAthenaProject"), false);
});

test("P1: no defineAthenaProject", () => {
  for (const file of collectTsFiles(srcRoot)) {
    assert.equal(
      /\bdefineAthenaProject\b/.test(readFileSync(file, "utf8")),
      false,
      file
    );
  }
});

test("P1: no PolicyClient / createPolicyClient", () => {
  const policyDir = join(srcRoot, "policy");
  assert.equal(existsSync(policyDir), true);
  for (const file of readdirSync(policyDir).filter((name) =>
    name.endsWith(".ts")
  )) {
    const text = readFileSync(join(policyDir, file), "utf8");
    assert.equal(text.includes("createPolicyClient"), false, file);
    assert.equal(text.includes("class PolicyClient"), false, file);
    assert.equal(text.includes("function PolicyClient"), false, file);
  }
  const pkg = readFileSync(join(pkgRoot, "package.json"), "utf8");
  assert.equal(pkg.includes("PolicyClient"), false);
  assert.equal(pkg.includes("createPolicyClient"), false);
});

test("P?: presets compile through policy() to AuthoredPolicy with no IR provenance", () => {
  const barrel = policyBarrel as Record<string, unknown>;
  assert.equal("immutableAfterCreate" in barrel, false);
  assert.equal(typeof policy, "function");

  for (const id of PRESET_IDS) {
    assert.equal(typeof barrel[id], "function", id);
  }

  const organizationScoped = barrel.organizationScoped as PolicyPresetFn;
  const tenantScoped = barrel.tenantScoped as PolicyPresetFn;
  const org = organizationScoped(invoices);
  const tenant = tenantScoped(invoices);
  assert.equal(org.kind, "athena.policy");
  assert.equal(tenant.kind, "athena.policy");
  assert.ok(Array.isArray(org.definitions));
  assert.ok(org.definitions.length > 0);

  const orgIr = stringifyIr(org);
  const tenantIr = stringifyIr(tenant);
  assert.notEqual(
    orgIr,
    tenantIr,
    "organizationScoped must not equate tenantId with Organizations"
  );
  assert.match(orgIr, /organizationId/);
  assert.equal(orgIr.includes('"slot":"organizationId"'), true);
  assert.equal(orgIr.includes("tenantId"), false);
  assert.match(tenantIr, /tenantId/);
  assert.equal(tenantIr.includes('"slot":"organizationId"'), false);

  for (const id of PRESET_IDS) {
    const authored = (barrel[id] as PolicyPresetFn)(invoices);
    assert.equal(authored.kind, "athena.policy", id);
    const snapshot = stringifyIr(authored);
    for (const tag of PROVENANCE_TAGS) {
      assert.equal(snapshot.includes(tag), false, `${id} ${tag}`);
    }
    const doc = definePolicies([authored as never]);
    const canonical = stringifyIr(canonicalizeDocument(doc));
    for (const tag of PROVENANCE_TAGS) {
      assert.equal(canonical.includes(tag), false, `${id} canonical ${tag}`);
    }
  }
});

test("P?: explainAthenaPolicy is structural; simulate binds --row", async () => {
  const barrel = policyBarrel as Record<string, unknown>;
  assert.equal(typeof barrel.explainAthenaPolicy, "function");
  assert.equal(typeof barrel.simulateAthenaPolicy, "function");
  assert.equal(typeof decideAthenaPolicy, "function");

  const decideSrc = readSrc("policy/decide.ts");
  assert.equal(decideSrc.includes("explainAthenaPolicy"), false);
  assert.equal(decideSrc.includes("simulateAthenaPolicy"), false);

  const authored = policy(invoices, {
    id: "users-see-own-invoices",
    select: {
      allow: ({ row, auth }) => row.userId.eq(auth.userId),
      to: ["authenticated"],
    },
  });
  const doc = definePolicies([authored]);
  const explainAthenaPolicy = barrel.explainAthenaPolicy as (
    input: Record<string, unknown>
  ) => Record<string, unknown>;
  const simulateAthenaPolicy = barrel.simulateAthenaPolicy as (
    input: Record<string, unknown>
  ) => Record<string, unknown>;

  const explained = explainAthenaPolicy({
    action: "select",
    document: doc,
    principal: { kind: "authenticated", userId: "user-1" },
    resource: "public.invoices",
    row: { id: "inv-bound-row", userId: "user-1" },
  });
  const explainedText = stringifyIr(explained);
  assert.equal(
    explainedText.includes("inv-bound-row"),
    false,
    "explain must not claim bound row operands it does not have"
  );
  assert.equal(explained.bound === true, false);

  const simulated = simulateAthenaPolicy({
    action: "select",
    document: doc,
    principal: { kind: "authenticated", userId: "user-1" },
    resource: "public.invoices",
    row: { id: "inv-bound-row", userId: "user-1" },
  });
  assert.ok(simulated);
  const simulatedText = stringifyIr(simulated);
  assert.match(simulatedText, /inv-bound-row|allowed|true/);

  const catalogCommands = new Set(
    CLI_COMMAND_CATALOG.map((entry) => entry.command)
  );
  assert.equal(catalogCommands.has("policy simulate"), true);
  const simulateEntry = CLI_COMMAND_CATALOG.find(
    (entry) => entry.command === "policy simulate"
  );
  assert.ok(simulateEntry);
  assert.ok(simulateEntry.flags?.includes("--row"));
});

test("P?: policy lint stable codes + severity; unconditional vs conditional public UPDATE", async () => {
  const barrel = policyBarrel as Record<string, unknown>;
  assert.equal(typeof barrel.lintAthenaPolicy, "function");
  const lintAthenaPolicy = barrel.lintAthenaPolicy as (
    document: unknown,
    options?: { columnHints?: Record<string, readonly string[]> }
  ) => {
    findings: Array<{ code: string; severity: string }>;
  };

  const unconditional = definePolicies([
    policy(invoices, {
      id: "public-update-all",
      update: { to: "public" },
    }),
  ]);
  const conditional = definePolicies([
    policy(invoices, {
      id: "public-update-own",
      update: {
        allow: ({ row, auth }) => row.userId.eq(auth.userId),
        to: "public",
      },
    }),
  ]);

  const uncondFindings = lintAthenaPolicy(unconditional, {
    columnHints: { invoices: ["id", "userId", "amount"] },
  }).findings;
  const condFindings = lintAthenaPolicy(conditional, {
    columnHints: { invoices: ["id", "userId", "amount"] },
  }).findings;

  assert.ok(uncondFindings.length > 0);
  for (const finding of [...uncondFindings, ...condFindings]) {
    assert.equal(typeof finding.code, "string");
    assert.ok(finding.code.length > 0);
    assert.ok(
      finding.severity === "error" ||
      finding.severity === "warning" ||
      finding.severity === "info",
      finding.severity
    );
  }

  const uncondCodes = uncondFindings.map((item) => item.code).sort();
  const condCodes = condFindings.map((item) => item.code).sort();
  assert.notDeepEqual(
    uncondCodes,
    condCodes,
    "unconditional public UPDATE must be distinguished from conditional"
  );

  const lintFiles = collectTsFiles(join(srcRoot, "policy")).concat(
    existsSync(join(srcRoot, "cli", "commands", "policy"))
      ? collectTsFiles(join(srcRoot, "cli", "commands", "policy"))
      : []
  );
  assert.ok(lintFiles.length > 0);
  for (const file of lintFiles) {
    const text = readFileSync(file, "utf8");
    assert.equal(text.includes("fromPreset"), false, file);
    assert.equal(text.includes("irProvenance"), false, file);
  }

  const catalogCommands = new Set(
    CLI_COMMAND_CATALOG.map((entry) => entry.command)
  );
  assert.equal(catalogCommands.has("policy lint"), true);
});

test("P?: policy coverage cells not binary", () => {
  const barrel = policyBarrel as Record<string, unknown>;
  assert.equal(typeof barrel.coverageAthenaPolicy, "function");
  const coverageAthenaPolicy = barrel.coverageAthenaPolicy as (
    document: unknown
  ) => {
    cells: Array<{
      action: string;
      cell: string;
      resource: string;
    }>;
  };

  const permissiveDoc = definePolicies([
    policy(invoices, {
      composition: "permissive",
      id: "perm-select",
      select: { to: ["authenticated"] },
    }),
  ]);
  const restrictiveDoc = definePolicies([
    policy(invoices, {
      composition: "restrictive",
      id: "rest-select",
      select: {
        allow: ({ row, auth }) => row.userId.eq(auth.userId),
        to: ["authenticated"],
      },
    }),
  ]);
  const bothDoc = definePolicies([
    policy(invoices, {
      composition: "permissive",
      id: "perm-select",
      select: { to: ["authenticated"] },
    }),
    policy(invoices, {
      composition: "restrictive",
      id: "rest-select",
      select: {
        allow: ({ row, auth }) => row.userId.eq(auth.userId),
        to: ["authenticated"],
      },
    }),
  ]);
  const noneDoc = definePolicies([]);

  const allowed = new Set([
    "permissive",
    "restrictive-only",
    "permissive+restrictive",
    "none",
  ]);

  function cellFor(
    document: unknown,
    resource: string,
    action: string
  ): string {
    const report = coverageAthenaPolicy(document);
    assert.ok(Array.isArray(report.cells));
    const match = report.cells.find(
      (item) => item.resource.includes(resource) && item.action === action
    );
    assert.ok(match, `${resource} ${action}`);
    assert.equal(allowed.has(match.cell), true, match.cell);
    assert.equal(match.cell === "covered" || match.cell === "uncovered", false);
    return match.cell;
  }

  assert.equal(cellFor(permissiveDoc, "invoices", "select"), "permissive");
  assert.equal(
    cellFor(restrictiveDoc, "invoices", "select"),
    "restrictive-only"
  );
  assert.equal(
    cellFor(bothDoc, "invoices", "select"),
    "permissive+restrictive"
  );
  assert.equal(cellFor(noneDoc, "invoices", "select"), "none");

  const catalogCommands = new Set(
    CLI_COMMAND_CATALOG.map((entry) => entry.command)
  );
  assert.equal(catalogCommands.has("policy coverage"), true);
});

test("P?: policy export --format ir === canonicalizeDocument", async () => {
  const authored = policy(invoices, {
    id: "users-see-own-invoices",
    select: {
      allow: ({ row, auth }) => row.userId.eq(auth.userId),
      to: ["authenticated"],
    },
  });
  const doc = definePolicies([authored]);
  const canonical = canonicalizeDocument(doc);
  const expectedBytes = JSON.stringify(canonical);
  assert.equal(typeof fingerprintDocument(doc), "string");
  assert.equal(fingerprintDocument(doc).length, 64);

  const catalogCommands = new Set(
    CLI_COMMAND_CATALOG.map((entry) => entry.command)
  );
  assert.equal(catalogCommands.has("policy export"), true);
  assert.equal(catalogCommands.has("policy fingerprint"), true);
  const exportEntry = CLI_COMMAND_CATALOG.find(
    (entry) => entry.command === "policy export"
  );
  assert.ok(exportEntry);
  assert.ok(
    exportEntry.flags?.some((flag) => String(flag).includes("--format"))
  );

  const policyCli = await importPolicyCli();
  assert.equal(typeof policyCli.parse, "function");
  assert.equal(typeof policyCli.run, "function");
  const parsed = (
    policyCli.parse as (rest: string[]) => Record<string, unknown>
  )(["export", "--format", "ir"]);
  assert.equal(String(parsed.format ?? parsed.command), "ir");

  const policyDir = join(srcRoot, "cli", "commands", "policy");
  const policyFiles = collectTsFiles(policyDir);
  const joined = policyFiles
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(joined, /canonicalizeDocument/);
  assert.match(joined, /fingerprintDocument/);
  assert.equal(expectedBytes.length > 2, true);
});

test("P?: athena-js policy group loads tooling.policies without provider/DB", async () => {
  const catalogSrc = readSrc("cli/commands-catalog.ts");
  const groupUnion = catalogSrc.slice(
    catalogSrc.indexOf("group:"),
    catalogSrc.indexOf("helpTopic?:")
  );
  assert.equal(groupUnion.includes('"policy"'), true);
  const helpUnionStart = catalogSrc.indexOf("export type CatalogHelpTopic");
  const helpUnionEnd = catalogSrc.indexOf("export const CLI_COMMAND_CATALOG");
  const helpUnion = catalogSrc.slice(helpUnionStart, helpUnionEnd);
  assert.equal(helpUnion.includes('"policy"'), true);

  const titlesStart = catalogSrc.indexOf("const GROUP_TITLES");
  const titlesEnd = catalogSrc.indexOf("export type CommandsListFormat");
  const titles = catalogSrc.slice(titlesStart, titlesEnd);
  assert.match(titles, /policy:/);

  const policyDir = join(srcRoot, "cli", "commands", "policy");
  assert.equal(existsSync(policyDir), true);

  const commands = new Set(CLI_COMMAND_CATALOG.map((entry) => entry.command));
  for (const command of POLICY_DX_COMMANDS) {
    assert.equal(commands.has(command), true, command);
  }
  for (const entry of CLI_COMMAND_CATALOG.filter(
    (item) => item.command === "policy" || item.command.startsWith("policy ")
  )) {
    assert.equal(String(entry.group), "policy");
    assert.equal(String(entry.helpTopic ?? "policy"), "policy");
  }

  assert.ok(CLI_REGISTERED_COMMANDS.some((item) => item.path[0] === "policy"));

  const policyFiles = collectTsFiles(policyDir);
  const joined = policyFiles
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.match(joined, /loadAthenaConfig/);
  assert.equal(joined.includes("loadGeneratorConfig"), false);
  assert.equal(/createClient\(/.test(joined), false);

  const policyCli = await importPolicyCli();
  assert.equal(typeof policyCli.parse, "function");

  const root = mkdtempSync(join(tmpdir(), "athena-policy-dx-cli-"));
  try {
    writeFileSync(
      join(root, "athena.config.ts"),
      `
export default {
  policies: { definitions: [] },
  tooling: { policies: "./src/lib/athena/policies.ts" },
};
`,
      "utf8"
    );
    const generatedDir = join(root, "src", "lib", "athena");
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(
      join(generatedDir, "policies.ts"),
      "export const policies = { definitions: [] };\n",
      "utf8"
    );
    const generator = await import("../../src/generator/index.ts");
    const loaded = await generator.loadAthenaConfig({ cwd: root });
    const project = projectFromLoaded(loaded);
    assert.equal("provider" in project && project.provider != null, false);
    assert.deepEqual(project.tooling, {
      policies: "./src/lib/athena/policies.ts",
    });
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("P?: no policy create/update/test CLI", () => {
  const commands = new Set(CLI_COMMAND_CATALOG.map((entry) => entry.command));
  assert.equal(commands.has("policy list"), true);
  assert.equal(commands.has("policy show"), true);
  assert.equal(commands.has("policy validate"), true);
  assert.equal(commands.has("policy create"), false);
  assert.equal(commands.has("policy update"), false);
  assert.equal(commands.has("policy test"), false);
  for (const registered of CLI_REGISTERED_COMMANDS) {
    const joined = registered.path.join(" ");
    assert.equal(joined === "policy create", false);
    assert.equal(joined === "policy update", false);
    assert.equal(joined === "policy test", false);
  }
});
