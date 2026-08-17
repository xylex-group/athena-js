export type CliOutputMode = "interactive" | "plain" | "json";

export type MigrationDisplayStatus =
  | "applied"
  | "pending"
  | "applying"
  | "repaired"
  | "drift"
  | "checksum-mismatch"
  | "missing-local"
  | "unknown"
  | "failed"
  | "skipped";

export interface CliCapabilities {
  mode: CliOutputMode;
  color: boolean;
  isTty: boolean;
  quiet: boolean;
  verbose: boolean;
}

export interface Diagnostic {
  code?: string;
  level: "info" | "warn" | "error";
  message: string;
  hint?: string;
  metadata?: Record<string, unknown>;
}

export interface MigrationRowView {
  name: string;
  status: MigrationDisplayStatus;
  detail?: string;
  durationMs?: number;
}

export interface MigrationSectionView {
  title: string;
  rows: MigrationRowView[];
  summary?: string;
}

export interface MigrationReportView {
  title: string;
  target?: {
    provider: string;
    database: string;
    directory: string;
  };
  application: MigrationSectionView;
  auth: MigrationSectionView;
  outcome: string;
  diagnostics: Diagnostic[];
  logPath?: string;
}

export interface AthenaCliUI {
  readonly capabilities: CliCapabilities;
  intro(title: string): void;
  outro(message: string): void;
  note(message: string, title?: string): void;
  warn(message: string): void;
  error(message: string): void;
  success(message: string): void;
  info(message: string): void;
  renderMigrationReport(report: MigrationReportView): void;
  confirm(message: string): Promise<boolean>;
}
