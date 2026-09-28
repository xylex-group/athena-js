export type CliOutputMode = "interactive" | "plain" | "json";

export type MigrationDisplayStatus =
  | "applied"
  | "pending"
  | "applying"
  | "repaired"
  | "drift"
  | "checksum-mismatch"
  | "legacy-compatible"
  | "missing-local"
  | "name-mismatch"
  | "historical-insertion"
  | "unknown"
  | "failed"
  | "skipped";

export interface CliCapabilities {
  color: boolean;
  isTty: boolean;
  mode: CliOutputMode;
  quiet: boolean;
  verbose: boolean;
}

export interface Diagnostic {
  code?: string;
  hint?: string;
  level: "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface MigrationRowView {
  detail?: string;
  durationMs?: number;
  name: string;
  status: MigrationDisplayStatus;
}

export interface MigrationSectionView {
  rows: MigrationRowView[];
  summary?: string;
  title: string;
}

export interface MigrationReportView {
  application: MigrationSectionView;
  auth: MigrationSectionView;
  diagnostics: Diagnostic[];
  logPath?: string;
  modules?: readonly MigrationSectionView[];
  outcome: string;
  target?: {
    provider: string;
    database: string;
    directory: string;
  };
  title: string;
}

export interface AthenaCliUI {
  readonly capabilities: CliCapabilities;
  confirm(message: string): Promise<boolean>;
  error(message: string): void;
  info(message: string): void;
  intro(title: string): void;
  note(message: string, title?: string): void;
  outro(message: string): void;
  renderMigrationReport(report: MigrationReportView): void;
  success(message: string): void;
  warn(message: string): void;
}
