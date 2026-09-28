import type {
  AthenaCliUI,
  CliCapabilities,
  MigrationReportView,
} from "./types.ts";

export function createJsonUi(
  capabilities: CliCapabilities,
  write: (message: string) => void = (message) => {
    console.log(message);
  }
): AthenaCliUI {
  let lastReport: MigrationReportView | undefined;

  return {
    capabilities,
    async confirm() {
      return false;
    },
    error(message) {
      write(JSON.stringify({ level: "error", message }));
    },
    info() {},
    intro() {},
    note() {},
    outro() {
      if (lastReport) {
        write(JSON.stringify(lastReport, null, 2));
      }
    },
    renderMigrationReport(report) {
      lastReport = report;
      write(JSON.stringify(report, null, 2));
    },
    success() {},
    warn(message) {
      write(JSON.stringify({ level: "warn", message }));
    },
  };
}
