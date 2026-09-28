import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { AthenaLocalRuntimeConfig } from "../generator/types.ts";
import { normalizeLocalRuntimeConfig } from "./config.ts";
import {
  assertOwnedDockerLabels,
  buildDockerLogsArgs,
  buildDockerRunArgs,
  buildDockerVolumeCreateArgs,
  createDockerProcess,
  type DockerInspect,
  type DockerProcess,
  type DockerVolumeInspect,
} from "./docker.ts";
import {
  buildLocalDatabaseUrl,
  resolveProjectEnvDatabaseUrlTarget,
  updateEnvDatabaseUrl,
} from "./env.ts";
import {
  createLocalProjectIdentity,
  type LocalProjectIdentity,
  localContainerName,
  localRuntimeDirectory,
  localVolumeName,
} from "./identity.ts";
import { withLocalRuntimeLock } from "./lock.ts";
import { waitForPostgres } from "./readiness.ts";
import {
  deleteLocalRuntimeState,
  type LocalRuntimeDiagnostics,
  type LocalRuntimeState,
  readLocalRuntimeState,
  redactLocalRuntimeState,
  writeLocalRuntimeState,
} from "./state.ts";

export type LocalRuntimeStatus =
  | "not-created"
  | "stopped"
  | "starting"
  | "healthy"
  | "unhealthy"
  | "orphaned"
  | "state-drift";

export interface LocalRuntimeStatusReport {
  diagnostics?: LocalRuntimeDiagnostics;
  reason?: string;
  status: LocalRuntimeStatus;
}

export interface LocalPostgresRuntimeOptions {
  config?: AthenaLocalRuntimeConfig;
  configPath: string;
  docker?: DockerProcess;
  migrate?: (connectionString: string) => Promise<void>;
  now?: () => Date;
  projectRoot: string;
  readiness?: typeof waitForPostgres;
}

export class LocalPostgresRuntime {
  readonly identity: LocalProjectIdentity;
  private readonly config: ReturnType<typeof normalizeLocalRuntimeConfig>;
  private readonly docker: DockerProcess;
  private readonly now: () => Date;
  private readonly readiness: typeof waitForPostgres;
  private readonly projectRoot: string;
  private readonly migrate?: (connectionString: string) => Promise<void>;

  constructor(options: LocalPostgresRuntimeOptions) {
    this.projectRoot = options.projectRoot;
    this.identity = createLocalProjectIdentity(
      options.projectRoot,
      options.configPath
    );
    this.config = normalizeLocalRuntimeConfig(options.config);
    this.docker = options.docker ?? createDockerProcess();
    this.now = options.now ?? (() => new Date());
    this.readiness = options.readiness ?? waitForPostgres;
    this.migrate = options.migrate;
    mkdirSync(localRuntimeDirectory(options.projectRoot), { recursive: true });
  }

  async start(
    options: { envPath?: string; forceEnv?: boolean; writeEnv?: boolean } = {}
  ): Promise<LocalRuntimeState> {
    return await withLocalRuntimeLock(this.projectRoot, () =>
      this.startUnlocked(options)
    );
  }

  async restart(
    options: { envPath?: string; forceEnv?: boolean; writeEnv?: boolean } = {}
  ): Promise<LocalRuntimeState> {
    return await withLocalRuntimeLock(this.projectRoot, async () => {
      await this.stopUnlocked();
      return await this.startUnlocked(options);
    });
  }

  private async startUnlocked(
    options: { envPath?: string; forceEnv?: boolean; writeEnv?: boolean } = {}
  ): Promise<LocalRuntimeState> {
    let state = readLocalRuntimeState(this.projectRoot);
    let containerCreated = false;
    let volumeCreated = false;
    let stateCreated = false;
    try {
      if (state && state.identity !== this.identity.id) {
        throw new Error(
          "Local runtime state belongs to a different project identity."
        );
      }
      if (state && this.stateDriftsFromConfig(state)) {
        throw new Error(
          "Local runtime state does not match the current local runtime configuration."
        );
      }
      if (state) {
        const inspect = await this.inspect(state.containerName);
        if (inspect) {
          assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
          this.assertContainerMatchesState(state, inspect);
          const volume = await this.inspectVolume(state.volumeName);
          if (!volume) {
            throw new Error(
              `Persisted state references a missing volume ${state.volumeName}.`
            );
          }
          assertOwnedDockerLabels(volume.labels, this.identity.id);
        }
        if (!inspect) {
          volumeCreated = await this.ensureVolume(state.volumeName);
          containerCreated = true;
          await this.runContainer(state);
        } else if (!inspect.running) {
          await this.startContainer(state.containerName);
        }
      } else {
        const containerName = localContainerName(this.identity);
        const inspect = await this.inspect(containerName);
        if (inspect) {
          assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
          state = await this.recoverState(inspect);
          if (!state) {
            throw new Error(
              `Cannot recover credentials for local PostgreSQL container ${containerName}.`
            );
          }
          if (this.stateDriftsFromConfig(state)) {
            throw new Error(
              "Recovered local runtime does not match the current local runtime configuration."
            );
          }
          if (!inspect.running) {
            await this.startContainer(state.containerName);
          }
          writeLocalRuntimeState(this.projectRoot, state);
        } else {
          state = this.createState();
          volumeCreated = await this.ensureVolume(state.volumeName);
          if (!volumeCreated) {
            throw new Error(
              "Local PostgreSQL runtime state is missing while its owned volume still exists; run db reset before starting again."
            );
          }
          containerCreated = true;
          await this.runContainer(state);
          writeLocalRuntimeState(this.projectRoot, state);
          stateCreated = true;
        }
      }

      if (!state) {
        throw new Error(
          "Local PostgreSQL runtime state could not be established."
        );
      }
      const url = buildLocalDatabaseUrl({
        database: state.database,
        host: this.config.host,
        password: state.password,
        port: state.port,
        user: state.user,
      });
      await this.readiness({
        connectionString: url,
        timeoutMs: this.config.startupTimeoutMs,
      });
      if (this.migrate) {
        await this.migrate(url);
      }
      if (options.writeEnv) {
        const target = resolveProjectEnvDatabaseUrlTarget(this.projectRoot);
        updateEnvDatabaseUrl(
          options.envPath ?? target.path,
          url,
          {
            envKey: target.envKey,
            force: options.forceEnv,
            managedDatabaseUrl: url,
          }
        );
      }
      return state;
    } catch (error) {
      if (state && (containerCreated || volumeCreated || stateCreated)) {
        await this.rollbackCreatedResources(state, {
          containerCreated,
          stateCreated,
          volumeCreated,
        });
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    await withLocalRuntimeLock(this.projectRoot, () => this.stopUnlocked());
  }

  private async stopUnlocked(): Promise<void> {
    const state = readLocalRuntimeState(this.projectRoot);
    const containerName =
      state?.containerName ?? localContainerName(this.identity);
    const inspect = await this.inspect(containerName);
    if (!inspect) {
      return;
    }
    assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
    if (inspect.running) {
      const result = await this.docker.run(["stop", containerName]);
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to stop ${containerName}.`);
      }
    }
  }

  async reset(): Promise<void> {
    await withLocalRuntimeLock(this.projectRoot, () => this.resetUnlocked());
  }

  private async resetUnlocked(): Promise<void> {
    const state = readLocalRuntimeState(this.projectRoot);
    if (!state) {
      const containerName = localContainerName(this.identity);
      const volumeName = localVolumeName(this.identity);
      const inspect = await this.inspect(containerName);
      if (inspect) {
        assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
        await this.removeContainer(containerName);
      }
      const volumeLabels = await this.inspectVolume(volumeName);
      if (volumeLabels) {
        assertOwnedDockerLabels(volumeLabels.labels, this.identity.id);
        await this.removeVolume(volumeName);
      }
      return;
    }
    const inspect = await this.inspect(state.containerName);
    if (inspect) {
      assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
      await this.removeContainer(state.containerName);
    }
    const volumeInspect = await this.inspectVolume(state.volumeName);
    if (volumeInspect) {
      assertOwnedDockerLabels(volumeInspect.labels, this.identity.id);
    }
    await this.removeVolume(state.volumeName);
    deleteLocalRuntimeState(this.projectRoot);
  }

  async status(): Promise<LocalRuntimeStatusReport> {
    return await withLocalRuntimeLock(this.projectRoot, () =>
      this.statusUnlocked()
    );
  }

  private async statusUnlocked(): Promise<LocalRuntimeStatusReport> {
    let state = readLocalRuntimeState(this.projectRoot);
    if (!state) {
      const containerName = localContainerName(this.identity);
      const inspect = await this.inspect(containerName);
      if (!inspect) {
        return { status: "not-created" };
      }
      try {
        assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
        state = await this.recoverState(inspect);
        if (!state) {
          return {
            reason:
              "Owned container metadata is insufficient to recover runtime state.",
            status: "orphaned",
          };
        }
        writeLocalRuntimeState(this.projectRoot, state);
      } catch (error) {
        if (error instanceof DockerInspectFailure) {
          throw error;
        }
        return {
          reason: error instanceof Error ? error.message : String(error),
          status: "orphaned",
        };
      }
    }
    if (state.identity !== this.identity.id) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: "Persisted state identity does not match the current project.",
        status: "state-drift",
      };
    }
    if (this.stateDriftsFromConfig(state)) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: "Persisted runtime settings do not match athena.config.ts.",
        status: "state-drift",
      };
    }
    const inspect = await this.inspect(state.containerName);
    if (!inspect) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: "Persisted state references a missing container.",
        status: "orphaned",
      };
    }
    try {
      assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
    } catch (error) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: error instanceof Error ? error.message : String(error),
        status: "orphaned",
      };
    }
    try {
      this.assertContainerMatchesState(state, inspect);
    } catch (error) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: error instanceof Error ? error.message : String(error),
        status: "state-drift",
      };
    }
    let volumeLabels: DockerVolumeInspect | undefined;
    try {
      volumeLabels = await this.inspectVolume(state.volumeName);
    } catch (error) {
      if (error instanceof DockerInspectFailure) {
        throw error;
      }
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: error instanceof Error ? error.message : String(error),
        status: "orphaned",
      };
    }
    if (!volumeLabels) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: "Persisted state references a missing volume.",
        status: "orphaned",
      };
    }
    try {
      assertOwnedDockerLabels(volumeLabels.labels, this.identity.id);
    } catch (error) {
      return {
        diagnostics: redactLocalRuntimeState(state),
        reason: error instanceof Error ? error.message : String(error),
        status: "orphaned",
      };
    }
    if (!inspect.running) {
      return { diagnostics: redactLocalRuntimeState(state), status: "stopped" };
    }
    try {
      await this.readiness({
        connectionString: buildLocalDatabaseUrl({
          database: state.database,
          host: this.config.host,
          password: state.password,
          port: state.port,
          user: state.user,
        }),
        timeoutMs: 1000,
      });
      return { diagnostics: redactLocalRuntimeState(state), status: "healthy" };
    } catch {
      return {
        diagnostics: redactLocalRuntimeState(state),
        status: "unhealthy",
      };
    }
  }

  async logs(): Promise<string> {
    const state = readLocalRuntimeState(this.projectRoot);
    const containerName =
      state?.containerName ?? localContainerName(this.identity);
    const inspect = await this.inspect(containerName);
    if (!inspect) {
      throw new Error(
        `Local PostgreSQL container ${containerName} was not found.`
      );
    }
    assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
    const result = await this.docker.run(buildDockerLogsArgs(containerName));
    if (result.code !== 0) {
      throw new Error(result.stderr || "Failed to read local PostgreSQL logs.");
    }
    if (!result.stderr) {
      return result.stdout;
    }
    if (!result.stdout) {
      return result.stderr;
    }
    return result.stdout.endsWith("\n")
      ? `${result.stdout}${result.stderr}`
      : `${result.stdout}\n${result.stderr}`;
  }

  private createState(): LocalRuntimeState {
    const containerName = localContainerName(this.identity);
    return {
      containerName,
      createdAt: this.now().toISOString(),
      database: this.config.database,
      identity: this.identity.id,
      image: this.config.image,
      password: randomBytes(24).toString("base64url"),
      port: this.config.port,
      user: this.config.user,
      volumeName: localVolumeName(this.identity),
    };
  }

  private stateDriftsFromConfig(state: LocalRuntimeState): boolean {
    return (
      state.database !== this.config.database ||
      state.image !== this.config.image ||
      state.port !== this.config.port ||
      state.user !== this.config.user
    );
  }

  private assertContainerMatchesState(
    state: LocalRuntimeState,
    inspect: DockerInspect
  ): void {
    const values = new Map<string, string>();
    for (const entry of inspect.env ?? []) {
      const separator = entry.indexOf("=");
      if (separator > 0) {
        values.set(entry.slice(0, separator), entry.slice(separator + 1));
      }
    }
    const drift =
      inspect.image !== state.image
        ? "image"
        : inspect.host !== this.config.host
          ? "host binding"
          : inspect.port !== state.port
            ? "port binding"
            : inspect.volumeName !== state.volumeName
              ? "volume"
              : values.get("POSTGRES_DB") !== state.database
                ? "POSTGRES_DB"
                : values.get("POSTGRES_USER") !== state.user
                  ? "POSTGRES_USER"
                  : values.get("POSTGRES_PASSWORD") !== state.password
                    ? "POSTGRES_PASSWORD"
                    : undefined;
    if (drift) {
      throw new Error(
        `Inspected local PostgreSQL container metadata does not match persisted state (${drift} drift).`
      );
    }
  }

  private async ensureVolume(volumeName: string): Promise<boolean> {
    const existing = await this.inspectVolume(volumeName);
    if (existing) {
      assertOwnedDockerLabels(existing.labels, this.identity.id);
      return false;
    }
    const result = await this.docker.run(
      buildDockerVolumeCreateArgs(volumeName, {
        "athena.client": this.identity.slug,
        "athena.managed": "true",
        "athena.project": this.identity.id,
        "athena.project.slug": this.identity.slug,
        "athena.service": "postgres",
      })
    );
    if (result.code !== 0) {
      throw new Error(result.stderr || `Failed to create ${volumeName}.`);
    }
    const created = await this.inspectVolume(volumeName);
    if (created) {
      assertOwnedDockerLabels(created.labels, this.identity.id);
    }
    return true;
  }

  private async inspectVolume(
    volumeName: string
  ): Promise<DockerVolumeInspect | undefined> {
    const result = await this.docker.run(["volume", "inspect", volumeName]);
    if (result.code !== 0) {
      if (isDockerNotFoundResult("volume", result.stderr, result.stdout)) {
        return undefined;
      }
      throw new DockerInspectFailure(
        result.stderr || `Failed to inspect Docker volume ${volumeName}.`
      );
    }
    const parsed: unknown = JSON.parse(result.stdout);
    if (
      !(Array.isArray(parsed) && parsed[0]) ||
      typeof parsed[0] !== "object"
    ) {
      throw new Error(`Docker returned invalid volume data for ${volumeName}.`);
    }
    const labels = (parsed[0] as { Labels?: unknown }).Labels;
    if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
      throw new Error(
        `Volume ${volumeName} is missing Athena ownership labels.`
      );
    }
    const name = (parsed[0] as { Name?: unknown }).Name;
    return {
      labels: labels as Record<string, string | undefined>,
      name: typeof name === "string" && name ? name : volumeName,
    };
  }

  private async runContainer(state: LocalRuntimeState): Promise<void> {
    const labels = {
      "athena.client": this.identity.slug,
      "athena.managed": "true",
      "athena.project": this.identity.id,
      "athena.project.slug": this.identity.slug,
      "athena.service": "postgres",
    };
    const result = await this.docker.run(
      buildDockerRunArgs({
        containerName: state.containerName,
        database: state.database,
        image: state.image,
        labels,
        password: state.password,
        port: state.port,
        user: state.user,
        volumeName: state.volumeName,
      })
    );
    if (result.code !== 0) {
      throw new Error(
        result.stderr || `Failed to start ${state.containerName}.`
      );
    }
  }

  private async recoverState(
    inspect: DockerInspect
  ): Promise<LocalRuntimeState | undefined> {
    const values = new Map<string, string>();
    for (const entry of inspect.env ?? []) {
      const separator = entry.indexOf("=");
      if (separator > 0) {
        values.set(entry.slice(0, separator), entry.slice(separator + 1));
      }
    }
    const password = values.get("POSTGRES_PASSWORD");
    if (
      !(password && inspect.image) ||
      inspect.port === undefined ||
      !inspect.volumeName
    ) {
      return undefined;
    }
    if (inspect.host === undefined || inspect.host !== this.config.host) {
      throw new Error(
        "Recovered local runtime host does not match the current local runtime configuration."
      );
    }
    const volume = await this.inspectVolume(inspect.volumeName);
    if (!volume) {
      return undefined;
    }
    assertOwnedDockerLabels(volume.labels, this.identity.id);
    return {
      containerName: localContainerName(this.identity),
      createdAt: this.now().toISOString(),
      database: values.get("POSTGRES_DB") ?? this.config.database,
      identity: this.identity.id,
      image: inspect.image,
      password,
      port: inspect.port,
      user: values.get("POSTGRES_USER") ?? this.config.user,
      volumeName: volume.name,
    };
  }

  private async startContainer(containerName: string): Promise<void> {
    const result = await this.docker.run(["start", containerName]);
    if (result.code !== 0) {
      throw new Error(result.stderr || `Failed to start ${containerName}.`);
    }
  }

  private async removeContainer(containerName: string): Promise<void> {
    const result = await this.docker.run(["rm", "--force", containerName]);
    if (result.code !== 0 && !/no such container/i.test(result.stderr)) {
      throw new Error(result.stderr || `Failed to remove ${containerName}.`);
    }
  }

  private async removeVolume(volumeName: string): Promise<void> {
    const result = await this.docker.run(["volume", "rm", volumeName]);
    if (result.code !== 0 && !/no such volume/i.test(result.stderr)) {
      throw new Error(result.stderr || `Failed to remove ${volumeName}.`);
    }
  }

  private async rollbackCreatedResources(
    state: LocalRuntimeState,
    resources: {
      containerCreated: boolean;
      stateCreated: boolean;
      volumeCreated: boolean;
    }
  ): Promise<void> {
    if (resources.containerCreated) {
      const inspect = await this.inspect(state.containerName);
      if (inspect) {
        assertOwnedDockerLabels(inspect.labels ?? {}, this.identity.id);
        await this.removeContainer(state.containerName);
      }
    }
    if (resources.volumeCreated) {
      await this.removeVolume(state.volumeName);
    }
    if (resources.stateCreated) {
      deleteLocalRuntimeState(this.projectRoot);
    }
  }

  private async inspect(
    containerName: string
  ): Promise<DockerInspect | undefined> {
    const result = await this.docker.run(["inspect", containerName]);
    if (result.code !== 0) {
      if (isDockerNotFoundResult("container", result.stderr, result.stdout)) {
        return undefined;
      }
      throw new DockerInspectFailure(
        result.stderr || `Failed to inspect Docker container ${containerName}.`
      );
    }
    const parsed: unknown = JSON.parse(result.stdout);
    if (
      !(Array.isArray(parsed) && parsed[0]) ||
      typeof parsed[0] !== "object"
    ) {
      throw new Error(
        `Docker returned invalid inspect data for ${containerName}.`
      );
    }
    const record = parsed[0] as {
      Config?: {
        Env?: string[];
        Image?: string;
        Labels?: Record<string, string | undefined>;
      };
      HostConfig?: {
        PortBindings?: Record<
          string,
          readonly { HostIp?: string; HostPort?: string }[]
        >;
      };
      Mounts?: readonly {
        Destination?: string;
        Name?: string;
        Source?: string;
        Type?: string;
      }[];
      State?: { Running?: boolean; Status?: string };
    };
    return {
      env: record.Config?.Env,
      host: this.parseHost(record.HostConfig?.PortBindings),
      image: record.Config?.Image,
      labels: record.Config?.Labels,
      port: this.parsePort(record.HostConfig?.PortBindings),
      running: record.State?.Running,
      status: record.State?.Status,
      volumeName: this.parseVolumeName(record.Mounts),
    };
  }

  private parseHost(
    bindings:
      | Record<string, readonly { HostIp?: string; HostPort?: string }[]>
      | undefined
  ): string | undefined {
    return bindings?.["5432/tcp"]?.[0]?.HostIp;
  }

  private parsePort(
    bindings:
      | Record<string, readonly { HostIp?: string; HostPort?: string }[]>
      | undefined
  ): number | undefined {
    const value = bindings?.["5432/tcp"]?.[0]?.HostPort;
    if (!value) {
      return undefined;
    }
    const port = Number(value);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  }

  private parseVolumeName(
    mounts:
      | readonly {
          Destination?: string;
          Name?: string;
          Source?: string;
          Type?: string;
        }[]
      | undefined
  ): string | undefined {
    const mount = mounts?.find(
      (candidate) =>
        candidate.Destination === "/var/lib/postgresql/data" &&
        candidate.Type === "volume"
    );
    return typeof mount?.Name === "string" && mount.Name.length > 0
      ? mount.Name
      : undefined;
  }
}

class DockerInspectFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DockerInspectFailure";
  }
}

function isDockerNotFoundResult(
  resource: "container" | "volume",
  stderr: string,
  stdout: string
): boolean {
  const payload = stdout.trim();
  if (payload && payload !== "[]") {
    return false;
  }
  const message = stderr.trim();
  if (resource === "container") {
    return /^Error:\s+No such (?:object|container)(?::\s+.+)?$/i.test(message);
  }
  return (
    /^Error response from daemon:\s+get\s+.+:\s+no such volume$/i.test(
      message
    ) ||
    /^Error:\s+No such (?:object|volume)(?::\s+.+)?$/i.test(message)
  );
}
