import { paint, statusColor } from "./colors.ts";
import { statusSymbol } from "./symbols.ts";
import { columnWidth, padEnd } from "./table.ts";
import type {
  AthenaCliUI,
  CliCapabilities,
  MigrationReportView,
} from "./types.ts";

export function createPlainUi(
  capabilities: CliCapabilities,
  write: (message: string) => void = (message) => {
    console.log(message);
  }
): AthenaCliUI {
  const interactiveLook = capabilities.mode === "interactive";

  return {
    capabilities,
    intro(title) {
      if (capabilities.quiet) {
        return;
      }
      write(title);
      write("");
    },
    outro(message) {
      if (capabilities.quiet) {
        return;
      }
      write("");
      write(message);
    },
    note(message, title) {
      if (capabilities.quiet) {
        return;
      }
      if (title) {
        write(title);
      }
      write(message);
    },
    warn(message) {
      write(paint(message, "yellow", capabilities));
    },
    error(message) {
      write(paint(message, "red", capabilities));
    },
    success(message) {
      if (capabilities.quiet) {
        return;
      }
      write(paint(message, "green", capabilities));
    },
    info(message) {
      if (capabilities.quiet) {
        return;
      }
      write(message);
    },
    renderMigrationReport(report: MigrationReportView) {
      if (capabilities.quiet && capabilities.mode !== "json") {
        return;
      }
      write(report.title);
      write("");
      if (report.target) {
        write("Target");
        write("");
        write(`Provider    ${report.target.provider}`);
        write(`Database    ${report.target.database}`);
        write(`Directory   ${report.target.directory}`);
        write("");
      }

      for (const section of [report.application, report.auth]) {
        write(section.title);
        write("");
        if (section.rows.length === 0) {
          write("  (none)");
        } else {
          const nameWidth = columnWidth(
            section.rows.map((row) => row.name),
            34
          );
          write(`  ${padEnd("Migration", nameWidth)}  Status`);
          for (const row of section.rows) {
            const symbol = statusSymbol(row.status, interactiveLook);
            const label = paint(
              `${symbol} ${row.status}`,
              statusColor(row.status),
              capabilities
            );
            const duration =
              row.durationMs !== undefined ? `  ${row.durationMs}ms` : "";
            write(`  ${padEnd(row.name, nameWidth)}  ${label}${duration}`);
            if (row.detail) {
              for (const line of row.detail.split("\n")) {
                write(`    ${line}`);
              }
            }
          }
        }
        if (section.summary) {
          write("");
          write(`  ${section.summary}`);
        }
        write("");
      }

      write(report.outcome);
      for (const diagnostic of report.diagnostics) {
        write("");
        write(diagnostic.message);
        if (diagnostic.hint) {
          write(diagnostic.hint);
        }
      }
      if (report.logPath) {
        write("");
        write(`Log: ${report.logPath}`);
      }
    },
    async confirm() {
      // Non-interactive plain UI never prompts.
      return false;
    },
  };
}
