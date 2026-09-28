export interface DockerRunOptions {
  containerName: string;
  database: string;
  image: string;
  labels: Record<string, string>;
  password: string;
  port: number;
  user: string;
  volumeName: string;
}

export interface DockerProcess {
  run(
    args: readonly string[]
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface DockerInspect {
  env?: readonly string[];
  host?: string;
  image?: string;
  labels?: Record<string, string | undefined>;
  port?: number;
  running?: boolean;
  status?: string;
  volumeName?: string;
}

export interface DockerVolumeInspect {
  labels: Record<string, string | undefined>;
  name: string;
}

export const REQUIRED_LOCAL_LABELS = [
  "athena.client",
  "athena.managed",
  "athena.project",
  "athena.project.slug",
  "athena.service",
] as const;

export function buildDockerRunArgs(options: DockerRunOptions): string[] {
  const args = [
    "run",
    "--detach",
    "--name",
    options.containerName,
    "--publish",
    `127.0.0.1:${options.port}:5432`,
    "--volume",
    `${options.volumeName}:/var/lib/postgresql/data`,
  ];
  for (const [key, value] of Object.entries(options.labels)) {
    args.push("--label", `${key}=${value}`);
  }
  args.push(
    "--env",
    `POSTGRES_DB=${options.database}`,
    "--env",
    `POSTGRES_USER=${options.user}`,
    "--env",
    `POSTGRES_PASSWORD=${options.password}`,
    options.image
  );
  return args;
}

export function buildDockerLogsArgs(containerName: string): string[] {
  return ["logs", "--timestamps", containerName];
}

export function buildDockerVolumeCreateArgs(
  volumeName: string,
  labels: Record<string, string>
): string[] {
  const args = ["volume", "create"];
  for (const [key, value] of Object.entries(labels)) {
    args.push("--label", `${key}=${value}`);
  }
  args.push(volumeName);
  return args;
}

export function assertOwnedDockerLabels(
  labels: Record<string, string | undefined>,
  projectId: string
): void {
  const owned =
    labels["athena.managed"] === "true" &&
    labels["athena.project"] === projectId &&
    labels["athena.service"] === "postgres" &&
    REQUIRED_LOCAL_LABELS.every((key) => Boolean(labels[key]));
  if (!owned) {
    throw new Error(
      `Refusing to operate on an unowned Athena PostgreSQL container (expected project ${projectId}).`
    );
  }
}

export function createDockerProcess(): DockerProcess {
  return {
    async run(args) {
      const { spawn } = await import("node:child_process");
      return await new Promise((resolve, reject) => {
        const child = spawn("docker", [...args], {
          shell: false,
          windowsHide: true,
        });
        let stdout = "";
        let stderr = "";
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.once("error", reject);
        child.once("close", (code) =>
          resolve({ code: code ?? 1, stderr, stdout })
        );
      });
    },
  };
}
