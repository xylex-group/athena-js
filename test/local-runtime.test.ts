import { strict as assert } from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";
import { loadStaticCliProject } from "../src/cli/project/load-project.ts";
import {
  DEFAULT_LOCAL_RUNTIME_CONFIG,
  normalizeLocalRuntimeConfig,
} from "../src/local/config.ts";
import {
  assertOwnedDockerLabels,
  buildDockerRunArgs,
} from "../src/local/docker.ts";
import {
  buildLocalDatabaseUrl,
  resolveProjectEnvDatabaseUrlPath,
  resolveProjectEnvDatabaseUrlTarget,
  updateEnvDatabaseUrl,
} from "../src/local/env.ts";
import {
  createLocalProjectIdentity,
  localProjectSlug,
} from "../src/local/identity.ts";
import { withLocalRuntimeLock } from "../src/local/lock.ts";
import { LocalPostgresRuntime } from "../src/local/runtime.ts";
import {
  readLocalRuntimeState,
  redactLocalRuntimeState,
  writeLocalRuntimeState,
} from "../src/local/state.ts";

test("local runtime config supplies stable postgres defaults", () => {
  assert.deepEqual(normalizeLocalRuntimeConfig(undefined), {
    ...DEFAULT_LOCAL_RUNTIME_CONFIG,
  });
  assert.deepEqual(
    normalizeLocalRuntimeConfig({
      database: "app",
      port: 55_432,
      user: "app",
    }),
    {
      ...DEFAULT_LOCAL_RUNTIME_CONFIG,
      database: "app",
      port: 55_432,
      user: "app",
    }
  );
  assert.throws(
    () => normalizeLocalRuntimeConfig({ host: "0.0.0.0" }),
    /loopback/i
  );
  assert.equal(normalizeLocalRuntimeConfig({ host: "::1" }).host, "127.0.0.1");
});

test("local project identity remains stable when the config path changes", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-"));
  try {
    const configPath = join(root, "athena.config.ts");
    const alternateConfigPath = join(root, "athena.local.config.ts");
    writeFileSync(configPath, "export default {};\n");
    writeFileSync(alternateConfigPath, "export default {};\n");
    const first = createLocalProjectIdentity(root, configPath);
    const second = createLocalProjectIdentity(
      root,
      join(root, ".", "athena.local.config.ts")
    );
    assert.equal(first.id, second.id);
    assert.equal(first.slug, localProjectSlug(first.id));
    assert.notEqual(
      first.id,
      createLocalProjectIdentity(join(root, ".."), configPath).id
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("docker run args use labels, a named volume, and no shell interpolation", () => {
  const args = buildDockerRunArgs({
    containerName: "athena-postgres-abc",
    database: "postgres",
    image: "postgres:17-alpine",
    labels: {
      "athena.client": "abc",
      "athena.managed": "true",
      "athena.project": "project-id",
      "athena.project.slug": "abc",
      "athena.service": "postgres",
    },
    password: "p@ss word",
    port: 54_322,
    user: "postgres",
    volumeName: "athena-postgres-abc",
  });
  assert.equal(args[0], "run");
  assert.equal(args.includes("--label"), true);
  assert.equal(args.includes("athena.managed=true"), true);
  assert.equal(args.includes("athena.project=project-id"), true);
  assert.equal(args.includes("--volume"), true);
  assert.equal(
    args.includes("athena-postgres-abc:/var/lib/postgresql/data"),
    true
  );
  assert.equal(args.includes("127.0.0.1:54322:5432"), true);
  assert.equal(args.includes("POSTGRES_PASSWORD=p@ss word"), true);
});

test("repository ignores generated local runtime credentials", () => {
  const repositoryRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  for (const path of [
    ".athena/runtime/postgres.json",
    "nested/project/.athena/runtime/postgres.json",
  ]) {
    const result = spawnSync(
      "git",
      ["check-ignore", "--no-index", path],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      }
    );
    assert.equal(result.status, 0, `${path}: ${result.stderr}`);
  }
});

test("reset ownership rejects foreign or incomplete docker labels", () => {
  assert.doesNotThrow(() =>
    assertOwnedDockerLabels(
      {
        "athena.client": "abc",
        "athena.managed": "true",
        "athena.project": "project-id",
        "athena.project.slug": "abc",
        "athena.service": "postgres",
      },
      "project-id"
    )
  );
  assert.throws(
    () =>
      assertOwnedDockerLabels(
        { "athena.managed": "true", "athena.project": "other" },
        "project-id"
      ),
    /owned/i
  );
});

test("runtime state persists credentials but diagnostics redact them", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-state-"));
  try {
    const state = {
      containerName: "container",
      createdAt: "2026-01-01T00:00:00.000Z",
      database: "postgres",
      identity: "project-id",
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: "volume",
    };
    writeLocalRuntimeState(root, state);
    assert.deepEqual(readLocalRuntimeState(root), state);
    assert.equal("password" in redactLocalRuntimeState(state), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer replaces DATABASE_URL without disturbing comments", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      "# keep this\nOTHER=value\nDATABASE_URL=postgres://postgres:old@127.0.0.1:54322/postgres\n"
    );
    const url = buildLocalDatabaseUrl({
      database: "postgres",
      host: "127.0.0.1",
      password: "secret",
      port: 54_322,
      user: "postgres",
    });
    updateEnvDatabaseUrl(envPath, url, { managedDatabaseUrl: url });
    const content = readFileSync(envPath, "utf8");
    assert.match(content, /# keep this/);
    assert.match(content, /OTHER=value/);
    assert.equal((content.match(/^DATABASE_URL=/gm) ?? []).length, 1);
    assert.match(content, /127\.0\.0\.1:54322/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer accepts an Athena-managed loopback URL on a custom port", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-port-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      "DATABASE_URL=postgres://user:old@127.0.0.1:55432/app\n"
    );
    updateEnvDatabaseUrl(envPath, "postgres://user:new@127.0.0.1:55432/app");
    assert.match(readFileSync(envPath, "utf8"), /user:new@127\.0\.0\.1:55432/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer protects unrelated loopback PostgreSQL URLs", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-unrelated-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      "DATABASE_URL=postgres://dev:secret@127.0.0.1:5432/manual\n"
    );
    assert.throws(
      () =>
        updateEnvDatabaseUrl(
          envPath,
          "postgres://postgres:managed@127.0.0.1:55432/postgres"
        ),
      /non-local DATABASE_URL/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer rejects an exported production DATABASE_URL", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-exported-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      'export DATABASE_URL="postgres://dev:secret@127.0.0.1:5432/production"\n'
    );
    assert.throws(
      () =>
        updateEnvDatabaseUrl(
          envPath,
          "postgres://postgres:managed@127.0.0.1:55432/postgres"
        ),
      /non-local DATABASE_URL/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer refuses a non-managed effective DATABASE_URL duplicate", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-duplicate-"));
  try {
    const envPath = join(root, ".env");
    const original =
      "DATABASE_URL=postgres://127.0.0.1:55432/local\nDATABASE_URL=postgres://db.example/production\n";
    writeFileSync(envPath, original);
    assert.throws(
      () =>
        updateEnvDatabaseUrl(
          envPath,
          "postgres://127.0.0.1:55432/postgres"
        ),
      /non-local DATABASE_URL/
    );
    assert.equal(readFileSync(envPath, "utf8"), original);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer canonicalizes duplicate managed DATABASE_URL assignments", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-duplicate-managed-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      "KEEP=1\nDATABASE_URL=postgres://127.0.0.1:55432/postgres\nexport DATABASE_URL=postgres://127.0.0.1:55432/postgres\n"
    );
    updateEnvDatabaseUrl(
      envPath,
      "postgres://127.0.0.1:55432/postgres"
    );
    const content = readFileSync(envPath, "utf8");
    assert.equal((content.match(/^(?:export\s+)?DATABASE_URL=/gm) ?? []).length, 1);
    assert.match(
      content,
      /^export DATABASE_URL=postgres:\/\/127\.0\.0\.1:55432\/postgres$/m
    );
    assert.match(content, /^KEEP=1$/m);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer preserves exported managed DATABASE_URL assignments", () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-local-env-exported-managed-")
  );
  try {
    const envPath = join(root, ".env");
    writeFileSync(
      envPath,
      "export DATABASE_URL=postgres://postgres:old@127.0.0.1:55432/postgres\n"
    );
    updateEnvDatabaseUrl(
      envPath,
      "postgres://postgres:new@127.0.0.1:55432/postgres"
    );
    assert.match(
      readFileSync(envPath, "utf8"),
      /^export DATABASE_URL=postgres:\/\/postgres:new@127\.0\.0\.1:55432\/postgres/m
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer protects loopback URLs that omit the managed port", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-default-port-"));
  try {
    const envPath = join(root, ".env");
    writeFileSync(envPath, "DATABASE_URL=postgres://localhost/app\n");
    assert.throws(
      () => updateEnvDatabaseUrl(envPath, "postgres://127.0.0.1:55432/app"),
      /non-local DATABASE_URL/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer resolves the effective layered DATABASE_URL file", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-layered-"));
  try {
    writeFileSync(join(root, ".env"), "DATABASE_URL=postgres://old/base\n");
    writeFileSync(
      join(root, ".env.local"),
      "DATABASE_URL=postgres://old/local\n"
    );
    writeFileSync(
      join(root, ".env.test.local"),
      "DATABASE_URL=postgres://old/test-local\n"
    );
    assert.equal(
      resolveProjectEnvDatabaseUrlPath(root, { NODE_ENV: "test" }),
      join(root, ".env.test.local")
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer follows generator direct-connection key precedence", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-generator-key-"));
  try {
    const envPath = join(root, ".env.local");
    writeFileSync(
      join(root, ".env"),
      "DATABASE_URL=postgres://127.0.0.1:55432/base\n"
    );
    writeFileSync(
      envPath,
      "ATHENA_GENERATOR_PG_URL=postgres://127.0.0.1:55432/local\n"
    );
    const target = resolveProjectEnvDatabaseUrlTarget(root, {
      DATABASE_URL: "postgres://db.example/production",
    });
    assert.deepEqual(target, {
      envKey: "ATHENA_GENERATOR_PG_URL",
      path: envPath,
    });

    updateEnvDatabaseUrl(envPath, "postgres://127.0.0.1:55432/postgres", {
      envKey: target.envKey,
      managedDatabaseUrl: "postgres://127.0.0.1:55432/local",
    });
    assert.equal(
      readFileSync(envPath, "utf8"),
      "ATHENA_GENERATOR_PG_URL=postgres://127.0.0.1:55432/postgres\n"
    );
    assert.equal(
      readFileSync(join(root, ".env"), "utf8"),
      "DATABASE_URL=postgres://127.0.0.1:55432/base\n"
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("environment writer rejects a process-owned higher-priority generator URL", () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-env-generator-process-"));
  try {
    writeFileSync(
      join(root, ".env"),
      "DATABASE_URL=postgres://127.0.0.1:55432/local\n"
    );
    assert.throws(
      () =>
        resolveProjectEnvDatabaseUrlTarget(root, {
          ATHENA_GENERATOR_PG_URL: "postgres://db.example/production",
        }),
      /Cannot write ATHENA_GENERATOR_PG_URL: the effective value comes from the process environment/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime lock recovers after its owner subprocess exits", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-lock-recovery-"));
  try {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const child = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--eval",
        [
          'import { withLocalRuntimeLock } from "./src/local/lock.ts";',
          "await withLocalRuntimeLock(process.env.ATHENA_LOCK_ROOT, async () => {",
          "  process.exit(0);",
          "});",
        ].join("\n"),
      ],
      {
        cwd: packageRoot,
        encoding: "utf8",
        env: { ...process.env, ATHENA_LOCK_ROOT: root },
      }
    );
    assert.equal(child.status, 0, child.stderr);
    const result = await Promise.race([
      withLocalRuntimeLock(root, async () => "recovered"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("stale lifecycle lock was not recovered")),
          500
        )
      ),
    ]);
    assert.equal(result, "recovered");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime lock does not enter the critical section concurrently during stale recovery", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-lock-race-"));
  try {
    const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const lockDirectory = join(root, ".athena", "runtime");
    mkdirSync(lockDirectory, { recursive: true });
    writeFileSync(
      join(lockDirectory, "postgres.lock"),
      JSON.stringify({
        createdAt: "2020-01-01T00:00:00.000Z",
        pid: 2_147_483_647,
      })
    );
    const childSource = [
      'import { existsSync, unlinkSync, writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'import { withLocalRuntimeLock } from "./src/local/lock.ts";',
      "const root = process.env.ATHENA_LOCK_ROOT;",
      "if (!root) throw new Error('missing lock root');",
      "await withLocalRuntimeLock(root, async () => {",
      "  const marker = join(root, 'critical-section');",
      "  if (existsSync(marker)) process.exit(42);",
      "  writeFileSync(marker, String(process.pid), { flag: 'wx' });",
      "  await new Promise((resolve) => setTimeout(resolve, 100));",
      "  unlinkSync(marker);",
      "});",
    ].join("\n");
    const children = Array.from({ length: 6 }, () => {
      const child = spawn(
        process.execPath,
        ["--import", "tsx", "--eval", childSource],
        {
          cwd: packageRoot,
          env: { ...process.env, ATHENA_LOCK_ROOT: root },
          stdio: ["ignore", "ignore", "pipe"],
        }
      );
      return new Promise<{ code: number | null; stderr: string }>((resolve) => {
        let stderr = "";
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("close", (code) => resolve({ code, stderr }));
      });
    });
    const results = await Promise.all(children);
    assert.deepEqual(
      results.filter((result) => result.code !== 0),
      [],
      results.map((result) => result.stderr).join("\n")
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("static project loading accepts local-only config without a provider", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-config-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(
      configPath,
      "export default { local: { port: 55432 }, models: {} };\n"
    );
    const loaded = await loadStaticCliProject({ cwd: root });
    assert.equal(loaded.athena.config.local?.port, 55_432);
    assert.equal(loaded.athena.config.provider, undefined);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime start reuses persisted credentials and waits for postgres", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-runtime-"));
  const calls: string[][] = [];
  let running = false;
  let volumeExists = false;
  let projectId = "";
  let projectSlug = "";
  let runArgs: readonly string[] = [];
  const docker = {
    async run(args: readonly string[]) {
      calls.push([...args]);
      if (args[0] === "inspect") {
        return {
          code: running ? 0 : 1,
          stderr: running ? "" : "Error: No such object",
          stdout: running
            ? JSON.stringify([
                {
                  Config: {
                    Env: [
                      runArgs.find((arg) => arg.startsWith("POSTGRES_DB=")) ??
                        "POSTGRES_DB=postgres",
                      runArgs.find((arg) =>
                        arg.startsWith("POSTGRES_PASSWORD=")
                      ) ?? "POSTGRES_PASSWORD=secret",
                      runArgs.find((arg) => arg.startsWith("POSTGRES_USER=")) ??
                        "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": projectSlug,
                      "athena.managed": "true",
                      "athena.project": projectId,
                      "athena.project.slug": projectSlug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${projectSlug}`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: true, Status: "running" },
                },
              ])
            : "",
        };
      }
      if (args[0] === "volume" && args[1] === "inspect") {
        return volumeExists
          ? {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": projectSlug,
                    "athena.managed": "true",
                    "athena.project": projectId,
                    "athena.project.slug": projectSlug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${projectSlug}`,
                },
              ]),
            }
          : { code: 1, stderr: "Error: No such object", stdout: "" };
      }
      if (args[0] === "volume" && args[1] === "create") {
        volumeExists = true;
      }
      if (args[0] === "run") {
        runArgs = args;
        running = true;
      }
      return { code: 0, stderr: "", stdout: "ok" };
    },
  };
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker,
      projectRoot: root,
      readiness: async (options) => {
        assert.match(options.connectionString, /127\.0\.0\.1:54322/);
      },
    });
    projectId = runtime.identity.id;
    projectSlug = runtime.identity.slug;
    const first = await runtime.start();
    const second = await runtime.start();
    assert.equal(first.password, second.password);
    assert.equal(calls.filter(([command]) => command === "run").length, 1);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime treats docker inspect [] plus no such object as missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-inspect-empty-array-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 1,
              stderr: `error: no such object: ${args[1]}\n`,
              stdout: "[]\n",
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 1,
              stderr: `error: no such object: ${args[2]}\n`,
              stdout: "[]\n",
            };
          }
          if (args[0] === "volume" && args[1] === "create") {
            return { code: 0, stderr: "", stdout: args[args.length - 1] ?? "" };
          }
          if (args[0] === "run") {
            return { code: 0, stderr: "", stdout: "ok" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    const report = await runtime.status();
    assert.equal(report.status, "orphaned");
    const started = await runtime.start();
    assert.equal(started.database, "postgres");
    assert.equal(
      calls.some(([command]) => command === "run"),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime refuses to start an existing container with missing labels", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-null-labels-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                { Config: { Labels: null }, State: { Running: false } },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });

    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await assert.rejects(() => runtime.start(), /owned/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime validates the persisted volume before starting its container", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-volume-ownership-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const calls: string[][] = [];
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: false },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {
        assert.fail("readiness must not run for an unowned volume");
      },
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await assert.rejects(() => runtime.start(), /owned/i);
    assert.equal(calls.some(([command]) => command === "start"), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime surfaces docker start failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-start-failure-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: false },
                },
              ]),
            };
          }
          if (args[0] === "start") {
            return { code: 1, stderr: "docker start failed", stdout: "" };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await assert.rejects(() => runtime.start(), /docker start failed/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime recovers owned resources when persisted state is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-recover-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    let running = false;
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      config: { host: "localhost" },
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Source: `/var/lib/docker/volumes/athena-postgres-${runtime.identity.slug}/_data`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: running },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            assert.deepEqual(args, [
              "volume",
              "inspect",
              `athena-postgres-${runtime.identity.slug}`,
            ]);
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          if (args[0] === "start") {
            running = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    const state = await runtime.start();
    assert.equal(state.password, "recovered-secret");
    assert.equal(readLocalRuntimeState(root)?.password, "recovered-secret");
    assert.equal(
      calls.some(
        ([command, name]) => command === "start" && name === state.containerName
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime recovers owned resources when persisted state is missing for ::1", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-recover-ipv6-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      config: { host: "::1" },
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [
                        { HostIp: "127.0.0.1", HostPort: "54322" },
                      ],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Source: `/var/lib/docker/volumes/athena-postgres-${runtime.identity.slug}/_data`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: true, Status: "running" },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    const state = await runtime.start();
    assert.equal(state.password, "recovered-secret");
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rejects recovered volume mounts without a logical Docker name", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-recover-invalid-volume-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: 123,
                      Source: "/var/lib/docker/volumes/unknown/_data",
                      Type: "volume",
                    },
                  ],
                  State: { Running: true, Status: "running" },
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(
      () => runtime.start(),
      /Cannot recover credentials/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rejects recovered Docker image, port, and volume drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-recover-drift-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:16-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "55433" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: "athena-postgres-drift-volume",
                      Source: "/var/lib/docker/volumes/athena-postgres-drift-volume/_data",
                      Type: "volume",
                    },
                  ],
                  State: { Running: true, Status: "running" },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: "athena-postgres-drift-volume",
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(() => runtime.start(), /does not match/);
    assert.equal(readLocalRuntimeState(root), undefined);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime refuses to reuse an owned volume when its state is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-lost-state-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return { code: 1, stderr: "Error: No such object", stdout: "" };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(() => runtime.start(), /state.*reset/i);
    assert.equal(
      calls.some(([command]) => command === "run"),
      false
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rolls back newly created resources when docker run fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-rollback-"));
  const calls: string[][] = [];
  let containerExists = false;
  let volumeExists = false;
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            if (!containerExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: false },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            if (!volumeExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "create") {
            volumeExists = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "run") {
            containerExists = true;
            return { code: 1, stderr: "docker run failed", stdout: "" };
          }
          if (args[0] === "rm") {
            containerExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "volume" && args[1] === "rm") {
            volumeExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(() => runtime.start(), /docker run failed/);
    assert.equal(readLocalRuntimeState(root), undefined);
    assert.equal(
      calls.some(([command]) => command === "rm"),
      true
    );
    assert.equal(
      calls.some(
        ([command, subcommand]) => command === "volume" && subcommand === "rm"
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rolls back fresh resources when readiness fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-readiness-rollback-"));
  const calls: string[][] = [];
  let containerExists = false;
  let volumeExists = false;
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            if (!containerExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: true },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            if (!volumeExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "create") {
            volumeExists = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "run") {
            containerExists = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "rm") {
            containerExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "volume" && args[1] === "rm") {
            volumeExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {
        throw new Error("postgres never became ready");
      },
    });
    await assert.rejects(() => runtime.start(), /postgres never became ready/);
    assert.equal(readLocalRuntimeState(root), undefined);
    assert.equal(containerExists, false);
    assert.equal(volumeExists, false);
    assert.equal(calls.some(([command]) => command === "rm"), true);
    assert.equal(
      calls.some(
        ([command, subcommand]) => command === "volume" && subcommand === "rm"
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rolls back fresh resources when migration fails", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-migration-rollback-"));
  let containerExists = false;
  let volumeExists = false;
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            if (!containerExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: true },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            if (!volumeExists) {
              return { code: 1, stderr: "Error: No such object", stdout: "" };
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "create") {
            volumeExists = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "run") {
            containerExists = true;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "rm") {
            containerExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          if (args[0] === "volume" && args[1] === "rm") {
            volumeExists = false;
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      migrate: async () => {
        throw new Error("migration failed");
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(() => runtime.start(), /migration failed/);
    assert.equal(readLocalRuntimeState(root), undefined);
    assert.equal(containerExists, false);
    assert.equal(volumeExists, false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime reset discovers and removes owned resources without state", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-reset-missing-state-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: false },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                },
              ]),
            };
          }
          if (args[0] === "inspect") {
            return { code: 1, stderr: "Error: No such object", stdout: "" };
          }
          return { code: 0, stderr: "", stdout: "" };
        },
      },
      projectRoot: root,
    });
    await runtime.reset();
    assert.equal(
      calls.some(
        ([command, force, name]) =>
          command === "rm" &&
          force === "--force" &&
          name === `athena-postgres-${runtime.identity.slug}`
      ),
      true
    );
    assert.equal(
      calls.some(
        ([command, subcommand, name]) =>
          command === "volume" &&
          subcommand === "rm" &&
          name === `athena-postgres-${runtime.identity.slug}`
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime stop discovers an owned container when state is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-stop-missing-state-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: true, Status: "running" },
                },
              ]),
            };
          }
          if (args[0] === "stop") {
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
    });
    await runtime.stop();
    assert.equal(
      calls.some(
        ([command, name]) =>
          command === "stop" &&
          name === `athena-postgres-${runtime.identity.slug}`
      ),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime propagates docker container inspect failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-inspect-error-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          assert.deepEqual(args.slice(0, 2), ["inspect", args[1]]);
          return {
            code: 1,
            stderr: "Cannot connect to the Docker daemon",
            stdout: "",
          };
        },
      },
      projectRoot: root,
    });
    await assert.rejects(
      () => runtime.stop(),
      /Cannot connect to the Docker daemon/
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime does not treat docker context inspect failures as missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-context-error-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          assert.deepEqual(args.slice(0, 2), ["inspect", args[1]]);
          return {
            code: 1,
            stderr: "Error: context not found",
            stdout: "",
          };
        },
      },
      projectRoot: root,
    });
    await assert.rejects(() => runtime.stop(), /context not found/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime propagates docker volume inspect failures", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-volume-error-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 1,
              stderr: "Error: No such container",
              stdout: "",
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 1,
              stderr: "permission denied",
              stdout: "",
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await assert.rejects(() => runtime.reset(), /permission denied/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime status does not turn docker volume context failures into orphaned", async () => {
  const root = mkdtempSync(
    join(tmpdir(), "athena-local-volume-context-error-")
  );
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [
                        { HostIp: "127.0.0.1", HostPort: "54322" },
                      ],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: false, Status: "exited" },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 1,
              stderr: "Error: context not found",
              stdout: "",
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await assert.rejects(() => runtime.status(), /context not found/);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime status and logs discover an owned container when state is missing", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-read-missing-state-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Source: `/var/lib/docker/volumes/athena-postgres-${runtime.identity.slug}/_data`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: true, Status: "running" },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          if (args[0] === "logs") {
            return {
              code: 0,
              stderr: "postgres warning\n",
              stdout: "postgres ready\n",
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    assert.equal(await runtime.logs(), "postgres ready\npostgres warning\n");
    const status = await runtime.status();
    assert.equal(status.status, "healthy");
    assert.equal(
      calls.some(([command]) => command === "logs"),
      true
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("concurrent local runtime starts keep the winner's resources", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-concurrent-start-"));
  let containerExists = false;
  let volumeExists = false;
  let runCount = 0;
  let removeCount = 0;
  let runArgs: readonly string[] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const createDocker = () => ({
      async run(args: readonly string[]) {
        if (args[0] === "inspect") {
          if (!containerExists) {
            return { code: 1, stderr: "Error: No such object", stdout: "" };
          }
          return {
            code: 0,
            stderr: "",
            stdout: JSON.stringify([
              {
                Config: {
                  Env: [
                    "POSTGRES_DB=postgres",
                    runArgs.find((arg) => arg.startsWith("POSTGRES_PASSWORD=")) ??
                      "POSTGRES_PASSWORD=secret",
                    "POSTGRES_USER=postgres",
                  ],
                  Image: "postgres:17-alpine",
                  Labels: {
                    "athena.client": runtimeA.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtimeA.identity.id,
                    "athena.project.slug": runtimeA.identity.slug,
                    "athena.service": "postgres",
                  },
                },
                HostConfig: {
                  PortBindings: {
                    "5432/tcp": [{ HostIp: "127.0.0.1", HostPort: "54322" }],
                  },
                },
                Mounts: [
                  {
                    Destination: "/var/lib/postgresql/data",
                    Name: `athena-postgres-${runtimeA.identity.slug}`,
                    Type: "volume",
                  },
                ],
                State: { Running: true, Status: "running" },
              },
            ]),
          };
        }
        if (args[0] === "volume" && args[1] === "inspect") {
          return volumeExists
            ? {
                code: 0,
                stderr: "",
                stdout: JSON.stringify([
                  {
                    Labels: {
                      "athena.client": runtimeA.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtimeA.identity.id,
                      "athena.project.slug": runtimeA.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                ]),
              }
            : { code: 1, stderr: "Error: No such object", stdout: "" };
        }
        if (args[0] === "volume" && args[1] === "create") {
          volumeExists = true;
          return { code: 0, stderr: "", stdout: "" };
        }
        if (args[0] === "run") {
          if (containerExists) {
            return { code: 1, stderr: "name already in use", stdout: "" };
          }
          containerExists = true;
          runArgs = args;
          runCount += 1;
          return { code: 0, stderr: "", stdout: "" };
        }
        if (args[0] === "rm") {
          removeCount += 1;
          containerExists = false;
          return { code: 0, stderr: "", stdout: "" };
        }
        if (args[0] === "volume" && args[1] === "rm") {
          volumeExists = false;
          return { code: 0, stderr: "", stdout: "" };
        }
        assert.fail(`unexpected docker command: ${args.join(" ")}`);
      },
    });
    const runtimeA = new LocalPostgresRuntime({
      configPath,
      docker: createDocker(),
      projectRoot: root,
      readiness: async () => {
        await new Promise((resolve) => setTimeout(resolve, 25));
      },
    });
    const runtimeB = new LocalPostgresRuntime({
      configPath,
      docker: createDocker(),
      projectRoot: root,
      readiness: async () => {},
    });
    await Promise.all([runtimeA.start(), runtimeB.start()]);
    assert.equal(runCount, 1);
    assert.equal(removeCount, 0);
    assert.equal(volumeExists, true);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime refuses to attach an unowned existing volume", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-volume-"));
  const calls: string[][] = [];
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          calls.push([...args]);
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                { Labels: { "athena.project": "another-project" } },
              ]),
            };
          }
          if (args[0] === "inspect") {
            return { code: 1, stderr: "Error: No such object", stdout: "" };
          }
          return { code: 0, stderr: "", stdout: "" };
        },
      },
      projectRoot: root,
      readiness: async () => {},
    });
    await assert.rejects(() => runtime.start(), /owned/i);
    assert.equal(
      calls.some(([command]) => command === "run"),
      false
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime reset removes owned resources and persisted state", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-reset-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime: LocalPostgresRuntime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  State: { Running: false },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                },
              ]),
            };
          }
          return { code: 0, stderr: "", stdout: "" };
        },
      },
      projectRoot: root,
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    await runtime.reset();
    assert.equal(readLocalRuntimeState(root), undefined);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime reports persisted configuration drift", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-drift-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      projectRoot: root,
    });

    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:16-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });
    const report = await runtime.status();
    assert.equal(report.status, "state-drift");
    assert.equal("password" in (report.diagnostics ?? {}), false);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime rejects persisted state when inspected container metadata drifts", async () => {
  const driftFields = ["image", "port", "env", "volume"] as const;
  for (const driftField of driftFields) {
    const root = mkdtempSync(
      join(tmpdir(), `athena-local-container-${driftField}-`)
    );
    try {
      const configPath = join(root, "athena.config.ts");
      writeFileSync(configPath, "export default { local: {} };\n");
      const identity = createLocalProjectIdentity(root, configPath);
      const volumeName = () => `athena-postgres-${identity.slug}`;
      const runtime = new LocalPostgresRuntime({
        configPath,
        docker: {
          async run(args) {
            if (args[0] === "inspect") {
              return {
                code: 0,
                stderr: "",
                stdout: JSON.stringify([
                  {
                    Config: {
                      Env: [
                        `POSTGRES_DB=${driftField === "env" ? "wrong" : "postgres"}`,
                        "POSTGRES_PASSWORD=secret",
                        "POSTGRES_USER=postgres",
                      ],
                      Image:
                        driftField === "image"
                          ? "postgres:16-alpine"
                          : "postgres:17-alpine",
                      Labels: {
                        "athena.client": identity.slug,
                        "athena.managed": "true",
                        "athena.project": identity.id,
                        "athena.project.slug": identity.slug,
                        "athena.service": "postgres",
                      },
                    },
                    HostConfig: {
                      PortBindings: {
                        "5432/tcp": [
                          {
                            HostIp: "127.0.0.1",
                            HostPort:
                              driftField === "port" ? "55432" : "54322",
                          },
                        ],
                      },
                    },
                    Mounts: [
                      {
                        Destination: "/var/lib/postgresql/data",
                        Name:
                          driftField === "volume"
                            ? `${volumeName()}-other`
                            : volumeName(),
                        Type: "volume",
                      },
                    ],
                    State: { Running: false },
                  },
                ]),
              };
            }
            assert.fail(`unexpected docker command: ${args.join(" ")}`);
          },
        },
        projectRoot: root,
        readiness: async () => {
          assert.fail("readiness must not run for container metadata drift");
        },
      });
      writeLocalRuntimeState(root, {
        containerName: volumeName(),
        createdAt: new Date().toISOString(),
        database: "postgres",
        identity: identity.id,
        image: "postgres:17-alpine",
        password: "secret",
        port: 54_322,
        user: "postgres",
        volumeName: volumeName(),
      });
      await assert.rejects(
        () => runtime.start(),
        /container metadata|does not match|drift/i
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  }
});

test("local runtime status reports container metadata drift before readiness", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-status-container-drift-"));
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:16-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [
                        { HostIp: "127.0.0.1", HostPort: "54322" },
                      ],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: `athena-postgres-${runtime.identity.slug}`,
                      Type: "volume",
                    },
                  ],
                  State: { Running: true },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: `athena-postgres-${runtime.identity.slug}`,
                },
              ]),
            };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      projectRoot: root,
      readiness: async () => {
        assert.fail("readiness must not run for container metadata drift");
      },
    });
    writeLocalRuntimeState(root, {
      containerName: `athena-postgres-${runtime.identity.slug}`,
      createdAt: new Date().toISOString(),
      database: "postgres",
      identity: runtime.identity.id,
      image: "postgres:17-alpine",
      password: "secret",
      port: 54_322,
      user: "postgres",
      volumeName: `athena-postgres-${runtime.identity.slug}`,
    });

    const report = await runtime.status();
    assert.equal(report.status, "state-drift");
    assert.match(report.reason ?? "", /metadata|drift/i);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
});

test("local runtime serializes status recovery with reset", async () => {
  const root = mkdtempSync(join(tmpdir(), "athena-local-status-reset-race-"));
  let releaseStatusVolume: (() => void) | undefined;
  let statusVolumeStarted: (() => void) | undefined;
  const statusVolumeReady = new Promise<void>((resolve) => {
    statusVolumeStarted = resolve;
  });
  const statusVolumeRelease = new Promise<void>((resolve) => {
    releaseStatusVolume = resolve;
  });
  let volumeInspectCount = 0;
  try {
    const configPath = join(root, "athena.config.ts");
    writeFileSync(configPath, "export default { local: {} };\n");
    const runtime = new LocalPostgresRuntime({
      configPath,
      docker: {
        async run(args) {
          const containerName = `athena-postgres-${runtime.identity.slug}`;
          if (args[0] === "inspect") {
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Config: {
                    Env: [
                      "POSTGRES_DB=postgres",
                      "POSTGRES_PASSWORD=recovered-secret",
                      "POSTGRES_USER=postgres",
                    ],
                    Image: "postgres:17-alpine",
                    Labels: {
                      "athena.client": runtime.identity.slug,
                      "athena.managed": "true",
                      "athena.project": runtime.identity.id,
                      "athena.project.slug": runtime.identity.slug,
                      "athena.service": "postgres",
                    },
                  },
                  HostConfig: {
                    PortBindings: {
                      "5432/tcp": [
                        { HostIp: "127.0.0.1", HostPort: "54322" },
                      ],
                    },
                  },
                  Mounts: [
                    {
                      Destination: "/var/lib/postgresql/data",
                      Name: containerName,
                      Type: "volume",
                    },
                  ],
                  State: { Running: true },
                },
              ]),
            };
          }
          if (args[0] === "volume" && args[1] === "inspect") {
            volumeInspectCount += 1;
            if (volumeInspectCount === 1) {
              statusVolumeStarted?.();
              await statusVolumeRelease;
            }
            return {
              code: 0,
              stderr: "",
              stdout: JSON.stringify([
                {
                  Labels: {
                    "athena.client": runtime.identity.slug,
                    "athena.managed": "true",
                    "athena.project": runtime.identity.id,
                    "athena.project.slug": runtime.identity.slug,
                    "athena.service": "postgres",
                  },
                  Name: containerName,
                },
              ]),
            };
          }
          if (args[0] === "rm" || args[0] === "volume") {
            return { code: 0, stderr: "", stdout: "" };
          }
          assert.fail(`unexpected docker command: ${args.join(" ")}`);
        },
      },
      configPath,
      projectRoot: root,
    });

    const statusPromise = runtime.status();
    await statusVolumeReady;
    const resetPromise = runtime.reset();
    await new Promise((resolve) => setImmediate(resolve));
    releaseStatusVolume?.();
    await Promise.all([statusPromise, resetPromise]);
    assert.equal(readLocalRuntimeState(root), undefined);
  } finally {
    releaseStatusVolume?.();
    rmSync(root, { force: true, recursive: true });
  }
});
