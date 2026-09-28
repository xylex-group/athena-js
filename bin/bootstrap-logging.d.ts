import type {
  AthenaCliLogger,
  BootstrapHandoffV1,
} from "../src/cli/logging/types.ts";

export function sanitizeCliArgv(argv: readonly unknown[]): string[];

export interface CliBootstrapSession extends AthenaCliLogger {
  adopt(logger: AthenaCliLogger): void;
  getBootstrapHandoff(): BootstrapHandoffV1;
}

export function createBootstrapSession(options: {
  argv: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageVersion?: string;
  noLog?: boolean;
}): CliBootstrapSession;
