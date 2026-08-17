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
    intro() {},
    outro() {
      if (lastReport) {
        write(JSON.stringify(lastReport, null, 2));
      }
    },
    note() {},
    warn(message) {
      write(JSON.stringify({ level: "warn", message }));
    },
    error(message) {
      write(JSON.stringify({ level: "error", message }));
    },
    success() {},
    info() {},
    renderMigrationReport(report) {
      lastReport = report;
      write(JSON.stringify(report, null, 2));
    },
    async confirm() {
      return false;
    },
  };
}
